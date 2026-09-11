import { all, insert, one, run, type SqlArg } from "./db";
import { generateOrderCode, generateReferralCode } from "./utils";
import type {
  DeliveryType,
  Deposit,
  DepositStatus,
  Order,
  OrderStatus,
  PaymentMethod,
  Product,
  ShopUser,
} from "./types";

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
  price, currency, status, txn_id, sender_number, admin_note, paid_from_balance,
  created_at, updated_at, delivered_at`;

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
  /**
   * True when the wallet already paid for the order. Such an order skips the
   * manual-payment step and starts life as `awaiting_review`, so it is visible
   * in the admin queue if the automatic delivery ever fails.
   */
  paidFromBalance?: boolean;
}): Promise<Order> {
  const paid = params.paidFromBalance ? 1 : 0;
  const status: OrderStatus = params.paidFromBalance ? "awaiting_review" : "awaiting_payment";

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateOrderCode();
    try {
      const id = await insert(
        `INSERT INTO orders
           (code, user_id, username, first_name, product_id, product_name, price, currency,
            status, paid_from_balance)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          code,
          params.userId,
          params.username,
          params.firstName,
          params.product.id,
          params.product.name,
          params.product.price,
          params.product.currency,
          status,
          paid,
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

/* ------------------------- wallet and referrals -------------------------- */

const USER_COLUMNS = `user_id, first_name, last_name, username, balance,
  referral_code, referred_by, referral_rewarded, created_at, last_seen_at`;

export async function getUser(userId: number): Promise<ShopUser | undefined> {
  return one<ShopUser>(`SELECT ${USER_COLUMNS} FROM users WHERE user_id = ?`, [userId]);
}

export async function findUserByReferralCode(
  code: string
): Promise<ShopUser | undefined> {
  return one<ShopUser>(
    `SELECT ${USER_COLUMNS} FROM users WHERE UPPER(referral_code) = UPPER(?)`,
    [code.trim()]
  );
}

/**
 * Returns a user's invite code, allocating one on first use.
 *
 * The unique index on `referral_code` is the collision guard: a taken code makes
 * the UPDATE fail, and the loop simply generates another one.
 */
export async function ensureReferralCode(userId: number): Promise<string> {
  const existing = await getUser(userId);
  if (existing?.referral_code) return existing.referral_code;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const code = generateReferralCode();
    try {
      await run(
        "UPDATE users SET referral_code = ? WHERE user_id = ? AND referral_code IS NULL",
        [code, userId]
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.toLowerCase().includes("unique")) throw error;
      continue;
    }

    const saved = await getUser(userId);
    if (saved?.referral_code) return saved.referral_code;
  }

  throw new Error("Could not allocate a referral code.");
}

/**
 * Records who invited a user. Only the first invitation counts, and nobody can
 * invite themselves.
 */
export async function attachReferrer(
  userId: number,
  referrerId: number
): Promise<boolean> {
  if (userId === referrerId) return false;

  const result = await run(
    "UPDATE users SET referred_by = ? WHERE user_id = ? AND referred_by IS NULL",
    [referrerId, userId]
  );
  return Number(result.rowsAffected ?? 0) > 0;
}

export async function creditBalance(userId: number, amount: number): Promise<void> {
  await run("UPDATE users SET balance = balance + ? WHERE user_id = ?", [
    amount,
    userId,
  ]);
}

/**
 * Takes money out of the wallet — but only if it is actually there.
 *
 * The `balance >= ?` guard lives in the WHERE clause on purpose: two orders
 * checked out at the same moment cannot both spend the same money.
 */
export async function debitBalance(userId: number, amount: number): Promise<boolean> {
  const result = await run(
    "UPDATE users SET balance = balance - ? WHERE user_id = ? AND balance >= ?",
    [amount, userId, amount]
  );
  return Number(result.rowsAffected ?? 0) > 0;
}

export async function countReferrals(userId: number): Promise<number> {
  const row = await one<{ total: number }>(
    "SELECT COUNT(*) AS total FROM users WHERE referred_by = ?",
    [userId]
  );
  return Number(row?.total ?? 0);
}

/**
 * Atomically claims the referral reward for an invitee.
 *
 * Returns true for exactly one caller. The claim happens *before* any money
 * moves, so a deposit approval and an order delivery arriving at the same
 * moment cannot both pay the referrer.
 */
export async function claimReferralReward(inviteeId: number): Promise<boolean> {
  const result = await run(
    `UPDATE users
     SET referral_rewarded = 1
     WHERE user_id = ? AND referral_rewarded = 0 AND referred_by IS NOT NULL`,
    [inviteeId]
  );
  return Number(result.rowsAffected ?? 0) > 0;
}

/** Total value of this user's delivered orders. */
export async function sumUserSpent(userId: number): Promise<number> {
  const row = await one<{ total: number | null }>(
    "SELECT SUM(price) AS total FROM orders WHERE user_id = ? AND status = 'delivered'",
    [userId]
  );
  return Number(row?.total ?? 0);
}

export async function countUserDeposits(userId: number): Promise<number> {
  const row = await one<{ total: number }>(
    "SELECT COUNT(*) AS total FROM deposits WHERE user_id = ?",
    [userId]
  );
  return Number(row?.total ?? 0);
}

/* ------------------------------ deposits --------------------------------- */

const DEPOSIT_COLUMNS = `id, code, user_id, amount, currency, status, txn_id,
  admin_note, method_id, method_name, created_at, updated_at, approved_at`;

export async function getDeposit(id: number): Promise<Deposit | undefined> {
  return one<Deposit>(`SELECT ${DEPOSIT_COLUMNS} FROM deposits WHERE id = ?`, [id]);
}

export async function createDeposit(params: {
  userId: number;
  amount: number;
  currency: string;
  /** The chosen top-up channel. The name is copied so history survives deletion. */
  methodId?: number | null;
  methodName?: string | null;
}): Promise<Deposit> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateOrderCode("DEP");
    try {
      const id = await insert(
        `INSERT INTO deposits (code, user_id, amount, currency, status, method_id, method_name)
         VALUES (?, ?, ?, ?, 'awaiting_payment', ?, ?)`,
        [
          code,
          params.userId,
          params.amount,
          params.currency,
          params.methodId ?? null,
          params.methodName ?? null,
        ]
      );
      const created = await getDeposit(id);
      if (created) return created;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.toLowerCase().includes("unique")) throw error;
    }
  }
  throw new Error("Could not generate a unique deposit code.");
}

/* --------------------------- payment methods ----------------------------- */

const METHOD_COLUMNS = `id, name, emoji, instructions, active, sort_order,
  created_at, updated_at`;

export async function listPaymentMethods(activeOnly: boolean): Promise<PaymentMethod[]> {
  return all<PaymentMethod>(
    `SELECT ${METHOD_COLUMNS} FROM payment_methods
     ${activeOnly ? "WHERE active = 1" : ""}
     ORDER BY sort_order, id`
  );
}

export async function getPaymentMethod(id: number): Promise<PaymentMethod | undefined> {
  return one<PaymentMethod>(
    `SELECT ${METHOD_COLUMNS} FROM payment_methods WHERE id = ?`,
    [id]
  );
}

export async function createPaymentMethod(input: {
  name: string;
  emoji: string;
  instructions: string;
}): Promise<number> {
  // New methods go to the end of the list.
  const row = await one<{ next: number | null }>(
    "SELECT MAX(sort_order) AS next FROM payment_methods"
  );
  return insert(
    `INSERT INTO payment_methods (name, emoji, instructions, active, sort_order)
     VALUES (?, ?, ?, 1, ?)`,
    [input.name, input.emoji, input.instructions, Number(row?.next ?? 0) + 1]
  );
}

const EDITABLE_METHOD_FIELDS = {
  name: "name",
  emoji: "emoji",
  instructions: "instructions",
  active: "active",
  sortOrder: "sort_order",
} as const;

export type EditableMethodField = keyof typeof EDITABLE_METHOD_FIELDS;

export async function updatePaymentMethod(
  id: number,
  patch: Partial<Record<EditableMethodField, string | number | null>>
): Promise<void> {
  const entries = Object.entries(patch).filter(([key]) => key in EDITABLE_METHOD_FIELDS);
  if (entries.length === 0) return;

  const assignments = entries.map(
    ([key]) => `${EDITABLE_METHOD_FIELDS[key as EditableMethodField]} = ?`
  );
  const args = entries.map(([, value]) => (value ?? null) as SqlArg);

  await run(
    `UPDATE payment_methods SET ${assignments.join(", ")}, updated_at = datetime('now')
     WHERE id = ?`,
    [...args, id]
  );
}

export async function deletePaymentMethod(id: number): Promise<void> {
  await run("DELETE FROM payment_methods WHERE id = ?", [id]);
}

export async function listUserDeposits(
  userId: number,
  limit: number,
  offset = 0
): Promise<Deposit[]> {
  return all<Deposit>(
    `SELECT ${DEPOSIT_COLUMNS} FROM deposits
     WHERE user_id = ?
     ORDER BY id DESC
     LIMIT ? OFFSET ?`,
    [userId, limit, offset]
  );
}

export async function listDeposits(options: {
  statuses?: DepositStatus[];
  limit: number;
  offset: number;
}): Promise<Deposit[]> {
  const statuses = options.statuses ?? [];
  const where = statuses.length
    ? `WHERE status IN (${statuses.map(() => "?").join(", ")})`
    : "";

  return all<Deposit>(
    `SELECT ${DEPOSIT_COLUMNS} FROM deposits ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...statuses, options.limit, options.offset]
  );
}

export async function countDeposits(statuses?: DepositStatus[]): Promise<number> {
  const list = statuses ?? [];
  const where = list.length
    ? `WHERE status IN (${list.map(() => "?").join(", ")})`
    : "";
  const row = await one<{ total: number }>(
    `SELECT COUNT(*) AS total FROM deposits ${where}`,
    list
  );
  return Number(row?.total ?? 0);
}

export async function markDepositUnderReview(
  depositId: number,
  txnId: string
): Promise<void> {
  await run(
    `UPDATE deposits
     SET status = 'awaiting_review', txn_id = ?, admin_note = NULL,
         updated_at = datetime('now')
     WHERE id = ?`,
    [txnId, depositId]
  );
}

export async function markDepositApproved(depositId: number): Promise<void> {
  await run(
    `UPDATE deposits
     SET status = 'approved', approved_at = datetime('now'), admin_note = NULL,
         updated_at = datetime('now')
     WHERE id = ?`,
    [depositId]
  );
}

export async function markDepositRejected(
  depositId: number,
  reason: string
): Promise<void> {
  await run(
    `UPDATE deposits
     SET status = 'rejected', admin_note = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [reason, depositId]
  );
}

export async function markDepositCancelled(depositId: number): Promise<void> {
  await run(
    `UPDATE deposits
     SET status = 'cancelled', updated_at = datetime('now')
     WHERE id = ?`,
    [depositId]
  );
}
