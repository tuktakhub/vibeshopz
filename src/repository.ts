import { all, insert, one, run, type SqlArg } from "./db";
import { generateOrderCode } from "./utils";
import type { DeliveryType, Order, OrderStatus, Product } from "./types";

/* ------------------------------ users ----------------------------------- */

export async function upsertUser(user: {
  id: number;
  firstName: string;
  lastName?: string;
  username?: string;
}): Promise<void> {
  await run(
    `INSERT INTO users (user_id, first_name, last_name, username, last_seen_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       first_name = excluded.first_name,
       last_name = excluded.last_name,
       username = excluded.username,
       last_seen_at = excluded.last_seen_at`,
    [user.id, user.firstName, user.lastName ?? null, user.username ?? null]
  );
}

/* ----------------------------- products --------------------------------- */

const PRODUCT_COLUMNS = `id, name, description, price, currency, category, active,
  delivery_type, file_id, file_name, delivery_text, stock, created_at, updated_at`;

export async function getProduct(id: number): Promise<Product | undefined> {
  return one<Product>(`SELECT ${PRODUCT_COLUMNS} FROM products WHERE id = ?`, [id]);
}

export async function countProducts(activeOnly: boolean): Promise<number> {
  const row = await one<{ total: number }>(
    `SELECT COUNT(*) AS total FROM products ${activeOnly ? "WHERE active = 1" : ""}`
  );
  return Number(row?.total ?? 0);
}

export async function listProducts(options: {
  activeOnly: boolean;
  limit: number;
  offset: number;
}): Promise<Product[]> {
  return all<Product>(
    `SELECT ${PRODUCT_COLUMNS} FROM products
     ${options.activeOnly ? "WHERE active = 1" : ""}
     ORDER BY id DESC
     LIMIT ? OFFSET ?`,
    [options.limit, options.offset]
  );
}

export interface NewProduct {
  name: string;
  description: string;
  price: number;
  currency: string;
  category: string | null;
  deliveryType: DeliveryType;
  fileId: string | null;
  fileName: string | null;
  deliveryText: string | null;
  stock: number | null;
}

export async function createProduct(input: NewProduct): Promise<number> {
  return insert(
    `INSERT INTO products
       (name, description, price, currency, category, active,
        delivery_type, file_id, file_name, delivery_text, stock)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
    [
      input.name,
      input.description,
      input.price,
      input.currency,
      input.category,
      input.deliveryType,
      input.fileId,
      input.fileName,
      input.deliveryText,
      input.stock,
    ]
  );
}

/** Whitelist mapping the wizard's camelCase keys onto real column names. */
const EDITABLE_PRODUCT_FIELDS = {
  name: "name",
  description: "description",
  price: "price",
  category: "category",
  active: "active",
  deliveryType: "delivery_type",
  fileId: "file_id",
  fileName: "file_name",
  deliveryText: "delivery_text",
  stock: "stock",
} as const;

export type EditableProductField = keyof typeof EDITABLE_PRODUCT_FIELDS;

export async function updateProduct(
  id: number,
  patch: Partial<Record<EditableProductField, string | number | null>>
): Promise<void> {
  const entries = Object.entries(patch).filter(
    ([key]) => key in EDITABLE_PRODUCT_FIELDS
  ) as [EditableProductField, string | number | null][];

  if (entries.length === 0) return;

  const assignments = entries.map(
    ([key]) => `${EDITABLE_PRODUCT_FIELDS[key]} = ?`
  );
  const args = entries.map(([, value]) => (value ?? null) as SqlArg);

  await run(
    `UPDATE products SET ${assignments.join(", ")}, updated_at = datetime('now') WHERE id = ?`,
    [...args, id]
  );
}

export async function deleteProduct(id: number): Promise<void> {
  await run("DELETE FROM products WHERE id = ?", [id]);
}

/** Takes one unit out of stock. Products with `stock IS NULL` are unlimited. */
export async function decrementStock(productId: number): Promise<void> {
  await run(
    `UPDATE products
     SET stock = stock - 1, updated_at = datetime('now')
     WHERE id = ? AND stock IS NOT NULL AND stock > 0`,
    [productId]
  );
}

/* ------------------------------ orders ---------------------------------- */

const ORDER_COLUMNS = `id, code, user_id, username, first_name, product_id, product_name,
  price, currency, status, txn_id, sender_number, admin_note, created_at, updated_at, delivered_at`;

export async function getOrder(id: number): Promise<Order | undefined> {
  return one<Order>(`SELECT ${ORDER_COLUMNS} FROM orders WHERE id = ?`, [id]);
}

export async function getOrderByCode(code: string): Promise<Order | undefined> {
  return one<Order>(
    `SELECT ${ORDER_COLUMNS} FROM orders WHERE UPPER(code) = UPPER(?)`,
    [code.trim()]
  );
}

export async function createOrder(params: {
  userId: number;
  username: string | null;
  firstName: string | null;
  product: Product;
}): Promise<Order> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateOrderCode();
    try {
      const id = await insert(
        `INSERT INTO orders
           (code, user_id, username, first_name, product_id, product_name, price, currency, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'awaiting_payment')`,
        [
          code,
          params.userId,
          params.username,
          params.firstName,
          params.product.id,
          params.product.name,
          params.product.price,
          params.product.currency,
        ]
      );
      const created = await getOrder(id);
      if (created) return created;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.toLowerCase().includes("unique")) throw error;
      // Order code collided — loop and generate a new one.
    }
  }
  throw new Error("Could not generate a unique order code. Please try again.");
}

export async function listUserOrders(
  userId: number,
  limit: number,
  offset: number
): Promise<Order[]> {
  return all<Order>(
    `SELECT ${ORDER_COLUMNS} FROM orders
     WHERE user_id = ?
     ORDER BY id DESC
     LIMIT ? OFFSET ?`,
    [userId, limit, offset]
  );
}

export async function countUserOrders(userId: number): Promise<number> {
  const row = await one<{ total: number }>(
    "SELECT COUNT(*) AS total FROM orders WHERE user_id = ?",
    [userId]
  );
  return Number(row?.total ?? 0);
}

export async function listOrders(options: {
  statuses?: OrderStatus[];
  limit: number;
  offset: number;
}): Promise<Order[]> {
  const statuses = options.statuses ?? [];
  const where = statuses.length
    ? `WHERE status IN (${statuses.map(() => "?").join(", ")})`
    : "";
  const args: SqlArg[] = [...statuses, options.limit, options.offset];

  return all<Order>(
    `SELECT ${ORDER_COLUMNS} FROM orders ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    args
  );
}

export async function countOrders(statuses?: OrderStatus[]): Promise<number> {
  const list = statuses ?? [];
  const where = list.length
    ? `WHERE status IN (${list.map(() => "?").join(", ")})`
    : "";
  const row = await one<{ total: number }>(
    `SELECT COUNT(*) AS total FROM orders ${where}`,
    list
  );
  return Number(row?.total ?? 0);
}

export async function countDeliveredRevenue(): Promise<number> {
  const row = await one<{ total: number | null }>(
    "SELECT SUM(price) AS total FROM orders WHERE status = 'delivered'"
  );
  return Number(row?.total ?? 0);
}

export async function markOrderUnderReview(
  orderId: number,
  txnId: string,
  senderNumber: string | null
): Promise<void> {
  await run(
    `UPDATE orders
     SET status = 'awaiting_review', txn_id = ?, sender_number = ?,
         admin_note = NULL, updated_at = datetime('now')
     WHERE id = ?`,
    [txnId, senderNumber, orderId]
  );
}

export async function markOrderDelivered(orderId: number): Promise<void> {
  await run(
    `UPDATE orders
     SET status = 'delivered', delivered_at = datetime('now'),
         admin_note = NULL, updated_at = datetime('now')
     WHERE id = ?`,
    [orderId]
  );
}

export async function markOrderRejected(
  orderId: number,
  reason: string
): Promise<void> {
  await run(
    `UPDATE orders
     SET status = 'rejected', admin_note = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [reason, orderId]
  );
}

export async function markOrderCancelled(orderId: number): Promise<void> {
  await run(
    `UPDATE orders
     SET status = 'cancelled', updated_at = datetime('now')
     WHERE id = ?`,
    [orderId]
  );
}
