/**
 * Database schema.
 *
 * Every statement is idempotent, so `ensureSchema()` can safely run on a cold
 * start of every serverless invocation (it is memoised per container, so in
 * practice it runs once per instance).
 *
 * `stock = NULL` means unlimited stock.
 */
export const SCHEMA_SQL: string[] = [
  `CREATE TABLE IF NOT EXISTS products (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL,
     description TEXT NOT NULL DEFAULT '',
     price REAL NOT NULL DEFAULT 0,
     currency TEXT NOT NULL DEFAULT 'BDT',
     category TEXT,
     active INTEGER NOT NULL DEFAULT 1,
     delivery_type TEXT NOT NULL DEFAULT 'text',
     file_id TEXT,
     file_name TEXT,
     delivery_text TEXT,
     stock INTEGER,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at TEXT NOT NULL DEFAULT (datetime('now'))
   )`,

  `CREATE TABLE IF NOT EXISTS orders (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     code TEXT NOT NULL UNIQUE,
     user_id INTEGER NOT NULL,
     username TEXT,
     first_name TEXT,
     product_id INTEGER NOT NULL,
     product_name TEXT NOT NULL,
     price REAL NOT NULL DEFAULT 0,
     currency TEXT NOT NULL DEFAULT 'BDT',
     status TEXT NOT NULL DEFAULT 'awaiting_payment',
     txn_id TEXT,
     sender_number TEXT,
      admin_note TEXT,
      paid_from_balance INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      delivered_at TEXT
    )`,

   `CREATE TABLE IF NOT EXISTS deposits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'BDT',
      status TEXT NOT NULL DEFAULT 'awaiting_payment',
      txn_id TEXT,
      admin_note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      approved_at TEXT
    )`,

   `CREATE TABLE IF NOT EXISTS users (
      user_id INTEGER PRIMARY KEY,
      first_name TEXT,
      last_name TEXT,
      username TEXT,
      balance REAL NOT NULL DEFAULT 0,
      referral_code TEXT,
      referred_by INTEGER,
      referral_rewarded INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT
    )`,

  `CREATE TABLE IF NOT EXISTS admins (
     user_id INTEGER PRIMARY KEY,
     added_by INTEGER,
     added_at TEXT NOT NULL DEFAULT (datetime('now'))
   )`,

  `CREATE TABLE IF NOT EXISTS settings (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL,
     updated_at TEXT NOT NULL DEFAULT (datetime('now'))
   )`,

  `CREATE TABLE IF NOT EXISTS user_states (
     user_id INTEGER PRIMARY KEY,
     state TEXT NOT NULL,
     data TEXT NOT NULL DEFAULT '{}',
     updated_at TEXT NOT NULL DEFAULT (datetime('now'))
   )`,

  `CREATE INDEX IF NOT EXISTS idx_orders_user ON orders (user_id, id DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status, id DESC)`,
   `CREATE INDEX IF NOT EXISTS idx_products_active ON products (active, id)`,
   `CREATE INDEX IF NOT EXISTS idx_deposits_user ON deposits (user_id, id DESC)`,
   `CREATE INDEX IF NOT EXISTS idx_deposits_status ON deposits (status, id DESC)`,
];

/**
 * Indexes that mention a column from ADDED_COLUMNS.
 *
 * They cannot live in SCHEMA_SQL: that batch runs *before* the columns are
 * added, and creating an index on a column that does not exist yet is an error.
 */
export const POST_MIGRATION_SQL: string[] = [
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code ON users (referral_code)`,
];

/**
 * Columns added after the first release.
 *
 * `CREATE TABLE IF NOT EXISTS` skips a table that already exists, so an already
 * deployed database would never receive new columns that way. `ensureSchema()`
 * reads `PRAGMA table_info` and adds whatever is missing, which keeps existing
 * rows intact — the live shop is migrated, never recreated.
 */
export const ADDED_COLUMNS: { table: string; column: string; definition: string }[] = [
  { table: "users", column: "balance", definition: "REAL NOT NULL DEFAULT 0" },
  { table: "users", column: "referral_code", definition: "TEXT" },
  { table: "users", column: "referred_by", definition: "INTEGER" },
  { table: "users", column: "referral_rewarded", definition: "INTEGER NOT NULL DEFAULT 0" },
  { table: "orders", column: "paid_from_balance", definition: "INTEGER NOT NULL DEFAULT 0" },
];

/** Keys that the admin panel is allowed to write into `settings`. */
export const SETTING_KEYS = [
  "shop_name",
  "support_username",
  "payment_method_name",
  "payment_number",
  "payment_instructions",
  "payment_note",
  "min_deposit",
  "referral_reward",
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];
