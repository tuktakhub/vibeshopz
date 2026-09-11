import { one, run } from "./db";

/**
 * A tiny serverless-safe finite state machine.
 *
 * grammY conversations keep state in memory, which does not survive between
 * serverless invocations. Storing the current step in Turso instead means a
 * multi-step wizard (picture upload, price entry, rejection reason, ...) works
 * even when every update lands on a different container.
 */
export interface UserState<T = Record<string, unknown>> {
  state: string;
  data: T;
}

export async function getState<T = Record<string, unknown>>(
  userId: number
): Promise<UserState<T> | null> {
  const row = await one<{ state: string; data: string }>(
    "SELECT state, data FROM user_states WHERE user_id = ?",
    [userId]
  );
  if (!row) return null;

  let data: T;
  try {
    data = JSON.parse(row.data || "{}") as T;
  } catch {
    data = {} as T;
  }
  return { state: row.state, data };
}

export async function setState(
  userId: number,
  state: string,
  data: Record<string, unknown> = {}
): Promise<void> {
  await run(
    `INSERT INTO user_states (user_id, state, data, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       state = excluded.state,
       data = excluded.data,
       updated_at = excluded.updated_at`,
    [userId, state, JSON.stringify(data)]
  );
}

export async function mergeState(
  userId: number,
  patch: Record<string, unknown>
): Promise<void> {
  const current = await getState(userId);
  if (!current) return;
  await setState(userId, current.state, { ...current.data, ...patch });
}

export async function clearState(userId: number): Promise<void> {
  await run("DELETE FROM user_states WHERE user_id = ?", [userId]);
}

/** Step names used by the admin product wizard. */
export const ADD_PRODUCT_STATES = {
  name: "admin:product:add:name",
  description: "admin:product:add:description",
  price: "admin:product:add:price",
  category: "admin:product:add:category",
  stock: "admin:product:add:stock",
  deliveryType: "admin:product:add:deliveryType",
  file: "admin:product:add:file",
  text: "admin:product:add:text",
  confirm: "admin:product:add:confirm",
} as const;

export const ADMIN_STATES = {
  editProduct: "admin:product:edit",
  deleteProduct: "admin:product:delete",
  orderReject: "admin:order:reject",
  setting: "admin:setting",
  addAdmin: "admin:admin:add",
} as const;

export const USER_STATES = {
  submitTxn: "user:order:txn",
} as const;
