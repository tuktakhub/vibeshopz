/**
 * End-to-end test of the database layer against a throwaway local libSQL file.
 * No Turso account or bot token is needed.
 *
 *   npm run test:local
 *
 * It exercises the schema, the product CRUD helpers and a full order lifecycle
 * (created -> under review -> delivered / rejected), then deletes the file.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Kept in the OS temp directory so a locked leftover never pollutes the repo.
const dbFile = path.join(os.tmpdir(), "digital-store-smoke-test.db");
removeDbFiles();

// Must be set before the app modules are imported.
process.env.TURSO_DATABASE_URL = `file:${dbFile}`;
process.env.TURSO_AUTH_TOKEN = "";
process.env.BOT_TOKEN = process.env.BOT_TOKEN ?? "100000:smoke-test-token";

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}` +
      (ok ? "" : `\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  );
}

function assert(label: string, condition: boolean, detail = ""): void {
  if (!condition) failures += 1;
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${condition ? "" : ` — ${detail}`}`);
}

async function main(): Promise<void> {
  const { ensureSchema, all } = await import("../src/db");
  const repo = await import("../src/repository");

  await ensureSchema();

  const tables = await all<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
  );
  const tableNames = tables.map((row) => row.name);
  for (const expected of [
    "admins",
    "orders",
    "products",
    "settings",
    "user_states",
    "users",
  ]) {
    assert(`table ${expected} exists`, tableNames.includes(expected), tableNames.join(", "));
  }

  /* ------------------------------ products ------------------------------ */

  const textProductId = await repo.createProduct({
    name: "Smoke test text product",
    description: "Delivered as a link.",
    price: 499,
    currency: "",
    category: "Templates",
    deliveryType: "text",
    fileId: null,
    fileName: null,
    deliveryText: "https://example.com/download",
    stock: null,
  });

  const fileProductId = await repo.createProduct({
    name: "Smoke test file product",
    description: "Delivered as a document.",
    price: 1200.5,
    currency: "",
    category: null,
    deliveryType: "both",
    fileId: "BAACAgEAAxkBAAExample",
    fileName: "kit.zip",
    deliveryText: "Licence: ABC-123",
    stock: 25,
  });

  assert("products were created", textProductId > 0 && fileProductId > 0);
  check("countProducts(all) == 2", await repo.countProducts(false), 2);
  check("countProducts(active) == 2", await repo.countProducts(true), 2);

  const textProduct = await repo.getProduct(textProductId);
  check("delivery_type round-trips", textProduct?.delivery_type, "text");
  check("unlimited stock stored as NULL", textProduct?.stock, null);
  check("price round-trips", (await repo.getProduct(fileProductId))?.price, 1200.5);

  await repo.updateProduct(fileProductId, { price: 999, stock: null, active: 0 });
  const updated = await repo.getProduct(fileProductId);
  check("price update applied", updated?.price, 999);
  check("stock cleared", updated?.stock, null);
  check("disabled product hidden from the catalogue", await repo.countProducts(true), 1);

  /* -------------------------------- orders ------------------------------- */

  const order = await repo.createOrder({
    userId: 555000111,
    username: "smoketester",
    firstName: "Smoke",
    product: (await repo.getProduct(textProductId))!,
  });

  assert("order code format", /^ORD-[A-Z2-9]{6}$/.test(order.code), order.code);
  check("new order status", order.status, "awaiting_payment");
  check("order snapshots the product name", order.product_name, "Smoke test text product");

  const second = await repo.createOrder({
    userId: 555000111,
    username: "smoketester",
    firstName: "Smoke",
    product: (await repo.getProduct(fileProductId))!,
  });
  assert("order codes are unique", order.code !== second.code, `${order.code} / ${second.code}`);

  await repo.markOrderUnderReview(order.id, "TRX123456", null);
  const reviewing = await repo.getOrder(order.id);
  check("status after submitting a TrxID", reviewing?.status, "awaiting_review");
  check("TrxID stored", reviewing?.txn_id, "TRX123456");

  check(
    "pending queue counts both open statuses",
    await repo.countOrders(["awaiting_payment", "awaiting_review"]),
    2
  );

  await repo.markOrderRejected(second.id, "TrxID not found");
  const rejected = await repo.getOrder(second.id);
  check("status after rejection", rejected?.status, "rejected");
  check("rejection reason stored", rejected?.admin_note, "TrxID not found");

  await repo.decrementStock(fileProductId);
  check("stock was already unlimited, so unchanged", (await repo.getProduct(fileProductId))?.stock, null);

  await repo.updateProduct(fileProductId, { stock: 3 });
  await repo.decrementStock(fileProductId);
  check("stock decrements", (await repo.getProduct(fileProductId))?.stock, 2);

  await repo.markOrderDelivered(order.id);
  const delivered = await repo.getOrder(order.id);
  check("status after delivery", delivered?.status, "delivered");
  assert("delivered_at is set", Boolean(delivered?.delivered_at), "delivered_at was null");
  check("delivered count", await repo.countOrders(["delivered"]), 1);
  check("revenue counts delivered orders only", await repo.countDeliveredRevenue(), 499);

  check("buyer order history", (await repo.listUserOrders(555000111, 10, 0)).length, 2);
  check("buyer order count", await repo.countUserOrders(555000111), 2);
  check("orders of another buyer", await repo.countUserOrders(999), 0);

  const found = await repo.getOrderByCode(order.code.toLowerCase());
  check("case-insensitive lookup by code", found?.id, order.id);

  await repo.markOrderCancelled(order.id);
  check("status after cancellation", (await repo.getOrder(order.id))?.status, "cancelled");

  /* -------------------------------- users -------------------------------- */

  await repo.upsertUser({ id: 555000111, firstName: "Smoke", username: "smoketester" });
  await repo.upsertUser({ id: 555000111, firstName: "Smoke Updated", username: "smoketester" });
  const users = await all<{ first_name: string }>("SELECT first_name FROM users");
  check("user upsert does not duplicate rows", users.length, 1);
  check("user upsert updates fields", users[0]?.first_name, "Smoke Updated");

  /* ------------------------------- settings ------------------------------ */

  const { getSetting, setSetting, getShopInfo } = await import("../src/settings");
  check("unset setting returns null", await getSetting("payment_number"), null);
  await setSetting("payment_number", "01711111111");
  check("setting round-trips", await getSetting("payment_number"), "01711111111");
  await setSetting("payment_number", "01722222222");
  check("setting upsert overwrites", await getSetting("payment_number"), "01722222222");
  check("shop info exposes the saved override", (await getShopInfo()).paymentNumber, "01722222222");

  /* ---------------------------- state machine ---------------------------- */

  const state = await import("../src/state");
  await state.setState(555000111, "user:order:txn", { orderId: 42 });
  const stored = await state.getState<{ orderId: number }>(555000111);
  check("state name stored", stored?.state, "user:order:txn");
  check("state data stored", stored?.data.orderId, 42);
  await state.mergeState(555000111, { extra: true });
  check("mergeState keeps the previous fields", (await state.getState(555000111))?.data, {
    orderId: 42,
    extra: true,
  });
  await state.clearState(555000111);
  check("state cleared", await state.getState(555000111), null);

  /* -------------------------------- cleanup ------------------------------ */

  await repo.deleteProduct(textProductId);
  check("product deleted", await repo.countProducts(false), 1);
  check("orders survive product deletion", (await repo.getOrder(order.id))?.product_name, "Smoke test text product");
}

/** Windows can keep the libSQL file handle briefly after close(), so retry. */
function removeDbFiles(): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    const candidate = `${dbFile}${suffix}`;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        if (!fs.existsSync(candidate)) break;
        fs.rmSync(candidate, { force: true });
        break;
      } catch {
        sleep(120);
      }
    }
  }
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Closes the libSQL client before removing the file — on Windows the native
 * driver keeps an open handle otherwise, which makes the unlink fail.
 */
async function cleanup(): Promise<void> {
  try {
    const { db } = await import("../src/db");
    await db().close();
  } catch {
    // Nothing to close.
  }
  removeDbFiles();
}

main()
  .catch((error) => {
    failures += 1;
    console.error("Unexpected error:", error);
  })
  .finally(async () => {
    await cleanup();
    if (failures > 0) {
      console.error(`\n${failures} check(s) failed.`);
      process.exit(1);
    }
    console.log("\nAll checks passed.");
  });
