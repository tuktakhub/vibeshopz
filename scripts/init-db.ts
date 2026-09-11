/**
 * Creates every table and index in the Turso database.
 *
 * Safe to run repeatedly — it only creates what is missing.
 *
 *   npm run db:init
 */
import { all, ensureSchema } from "../src/db";

async function main(): Promise<void> {
  await ensureSchema();

  const tables = await all<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
  );

  console.log("Schema is up to date.");
  console.log("Tables:", tables.map((row) => row.name).join(", "));
  console.log("Tip: run `npm run db:seed` to insert two example products.");
}

main().catch((error) => {
  console.error("db:init failed:", error);
  process.exit(1);
});
