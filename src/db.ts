import { createClient, type Client } from "@libsql/client";
import { config } from "./config";
import { ADDED_COLUMNS, POST_MIGRATION_SQL, SCHEMA_SQL } from "./schema";

/** Values we ever bind into a statement. */
export type SqlArg = string | number | bigint | null;

let client: Client | undefined;

/**
 * Lazily creates the Turso client.
 *
 * A remote libSQL client is stateless over HTTP, which makes it safe to reuse
 * across warm serverless invocations.
 */
export function db(): Client {
  if (!client) {
    client = createClient({
      url: config.tursoUrl,
      authToken: config.tursoAuthToken || undefined,
    });
  }
  return client;
}

export async function all<T = Record<string, unknown>>(
  sql: string,
  args: SqlArg[] = []
): Promise<T[]> {
  const result = await db().execute({ sql, args });
  return result.rows as unknown as T[];
}

export async function one<T = Record<string, unknown>>(
  sql: string,
  args: SqlArg[] = []
): Promise<T | undefined> {
  const rows = await all<T>(sql, args);
  return rows[0];
}

export async function run(sql: string, args: SqlArg[] = []) {
  return db().execute({ sql, args });
}

/** Runs an INSERT and returns the new row id. */
export async function insert(sql: string, args: SqlArg[] = []): Promise<number> {
  const result = await db().execute({ sql, args });
  return Number(result.lastInsertRowid ?? 0);
}

let schemaReady: Promise<void> | undefined;

/**
 * Adds columns that were introduced after the first release.
 *
 * `CREATE TABLE IF NOT EXISTS` cannot extend a table that already exists, so a
 * deployed shop would never see new columns otherwise. Reading
 * `PRAGMA table_info` first makes this safe to repeat and keeps existing rows.
 */
async function addMissingColumns(): Promise<void> {
  for (const { table, column, definition } of ADDED_COLUMNS) {
    const columns = await all<{ name: string }>(`PRAGMA table_info(${table})`);
    if (columns.some((entry) => entry.name === column)) continue;
    await run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/**
 * Gives a shop that predates the payment-methods table one method to start
 * from, built out of the manual payment details it already had.
 *
 * It runs at most once: the marker is stored in `settings`, so an admin who
 * deletes every method does not get this one back on the next deploy.
 */
async function seedPaymentMethods(): Promise<void> {
  const marker = await one<{ value: string }>(
    "SELECT value FROM settings WHERE key = 'payment_methods_seeded'"
  );
  if (marker) return;

  const existing = await one<{ count: number }>(
    "SELECT COUNT(*) AS count FROM payment_methods"
  );

  if (Number(existing?.count ?? 0) === 0) {
    const stored = await all<{ key: string; value: string }>(
      `SELECT key, value FROM settings
       WHERE key IN ('payment_method_name', 'payment_number', 'payment_instructions')`
    );
    const setting = (key: string): string =>
      stored.find((row) => row.key === key)?.value?.trim() ?? "";

    const name =
      setting("payment_method_name") || config.paymentDefaults.methodName || "Manual payment";
    const number = setting("payment_number") || config.paymentDefaults.number;
    const instructions =
      setting("payment_instructions") || config.paymentDefaults.instructions;

    const details = [
      number ? `Send the amount to: ${number}` : "",
      instructions,
    ]
      .filter(Boolean)
      .join("\n\n");

    await run(
      `INSERT INTO payment_methods (name, emoji, instructions, active, sort_order)
       VALUES (?, '💳', ?, 1, 0)`,
      [name, details]
    );
  }

  await run(
    `INSERT INTO settings (key, value, updated_at)
     VALUES ('payment_methods_seeded', '1', datetime('now'))
     ON CONFLICT(key) DO NOTHING`
  );
}

/**
 * Creates missing tables, migrates existing ones, then builds any index that
 * depends on a migrated column. Safe to call on every request: the work happens
 * at most once per serverless container.
 */
export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = db()
      .batch(
        SCHEMA_SQL.map((sql) => ({ sql })),
        "write"
      )
      .then(() => addMissingColumns())
      .then(() => db().batch(POST_MIGRATION_SQL.map((sql) => ({ sql })), "write"))
      .then(() => seedPaymentMethods())
      .then(() => undefined)
      .catch((error) => {
        // Allow a later request to retry if the first attempt failed.
        schemaReady = undefined;
        throw error;
      });
  }
  return schemaReady;
}
