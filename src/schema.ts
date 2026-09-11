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
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at TEXT NOT NULL DEFAULT (datetime('now')),
     delivered_at TEXT
   )`,

  `CREATE TABLE IF NOT EXISTS users (
     user_id INTEGER PRIMARY KEY,
     first_name TEXT,
     last_name TEXT,
     username TEXT,
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
];

/** Keys that the admin panel is allowed to write into `settings`. */
export const SETTING_KEYS = [
  "shop_name",
  "support_username",
  "payment_method_name",
  "payment_number",
  "payment_instructions",
  "payment_note",
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];
