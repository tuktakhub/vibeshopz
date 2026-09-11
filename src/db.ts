import { createClient, type Client } from "@libsql/client";
import { config } from "./config";
import { SCHEMA_SQL } from "./schema";

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
 * Creates the tables if they do not exist yet. Safe to call on every request:
 * the work happens at most once per serverless container.
 */
export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = db()
      .batch(
        SCHEMA_SQL.map((sql) => ({ sql })),
        "write"
      )
      .then(() => undefined)
      .catch((error) => {
        // Allow a later request to retry if the first attempt failed.
        schemaReady = undefined;
        throw error;
      });
  }
  return schemaReady;
}
