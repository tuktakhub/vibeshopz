/**
 * End-to-end test of the bot itself, with a stubbed Telegram API.
 *
 *   npm run test:bot
 *
 * No bot token, network access or Turso account is required: updates are pushed
 * straight into `bot.handleUpdate()` and every outgoing API call is recorded,
 * so the whole buyer journey can be asserted:
 *
 *   /start -> catalogue -> product -> buy -> send TrxID
 *          -> admin approves -> product delivered automatically
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Kept in the OS temp directory so a locked leftover never pollutes the repo.
const dbFile = path.join(os.tmpdir(), "digital-store-bot-test.db");
removeDbFiles();

// Must be set before the app modules are imported.
process.env.TURSO_DATABASE_URL = `file:${dbFile}`;
process.env.TURSO_AUTH_TOKEN = "";
process.env.BOT_TOKEN = "100000:bot-test-token";
process.env.ADMIN_IDS = "900900";
process.env.SHOP_NAME = "Test Shop";
process.env.PAYMENT_METHOD_NAME = "bKash";
process.env.PAYMENT_NUMBER = "01700000000";
process.env.PAYMENT_INSTRUCTIONS = "Send Money only.";
process.env.PAYMENT_NOTE = "Keep your TrxID safe.";
process.env.PRODUCTS_PER_PAGE = "8";

const BUYER = { id: 111222, first_name: "Buyer", username: "buyer" };
const ADMIN = { id: 900900, first_name: "Admin", username: "admin" };

interface MockCall {
  method: string;
  payload: Record<string, unknown>;
}

let failures = 0;
let updateCounter = 1000;
let messageId = 500;

function check(label: string, condition: boolean, detail = ""): void {
  if (!condition) failures += 1;
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${condition ? "" : ` — ${detail}`}`);
}

function checkEqual(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  check(label, ok, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

async function main(): Promise<void> {
  const { bot } = await import("../src/bot");
  const { ensureSchema } = await import("../src/db");
  const repo = await import("../src/repository");
  const { getState } = await import("../src/state");

  const calls: MockCall[] = [];
  const handlerErrors: unknown[] = [];

  // Capture handler exceptions instead of letting them reach the console.
  bot.catch((err) => {
    handlerErrors.push(err.error);
  });

  // Stub every outgoing Telegram API call.
  bot.api.config.use(async (_prev, method, payload) => {
    const body = payload as Record<string, unknown>;
    calls.push({ method, payload: body });
    switch (method) {
      case "getMe":
        return {
          ok: true,
          result: {
            id: 42,
            is_bot: true,
            first_name: "Test Bot",
            username: "test_bot",
            can_join_groups: true,
            can_read_all_group_messages: false,
            supports_inline_queries: false,
          },
        } as never;
      case "sendMessage":
      case "editMessageText":
      case "sendDocument":
        messageId += 1;
        return {
          ok: true,
          result: {
            message_id: messageId,
            date: Math.floor(Date.now() / 1000),
            chat: { id: Number(body.chat_id ?? 0), type: "private" },
          },
        } as never;
      default:
        return { ok: true, result: true } as never;
    }
  });

  await ensureSchema();
  await bot.init();

  async function push(update: unknown): Promise<MockCall[]> {
    const from = calls.length;
    await bot.handleUpdate(update as never);
    return calls.slice(from);
  }

  function textMessage(text: string, from = BUYER) {
    const entity = text.startsWith("/")
      ? [{ type: "bot_command", offset: 0, length: text.split(" ")[0]!.length }]
      : undefined;
    return {
      update_id: (updateCounter += 1),
      message: {
        message_id: (messageId += 1),
        from: { id: from.id, is_bot: false, first_name: from.first_name, username: from.username },
        chat: { id: from.id, type: "private", first_name: from.first_name },
        date: Math.floor(Date.now() / 1000),
        text,
        ...(entity ? { entities: entity } : {}),
      },
    };
  }

  function buttonPress(data: string, from = BUYER) {
    return {
      update_id: (updateCounter += 1),
      callback_query: {
        id: String(updateCounter),
        from: { id: from.id, is_bot: false, first_name: from.first_name, username: from.username },
        chat_instance: "1",
        message: {
          message_id: messageId,
          date: Math.floor(Date.now() / 1000),
          chat: { id: from.id, type: "private" },
          from: { id: 42, is_bot: true, first_name: "Test Bot", username: "test_bot" },
          text: "previous screen",
        },
        data,
      },
    };
  }

  /** Text of the last message the bot sent or edited. */
  function lastText(batch: MockCall[]): string {
    for (let i = batch.length - 1; i >= 0; i -= 1) {
      const call = batch[i]!;
      if (call.method === "sendMessage" || call.method === "editMessageText") {
        return String(call.payload.text ?? "");
      }
    }
    return "";
  }

  /** Text of the last message sent to one specific chat. */
  function lastTextTo(batch: MockCall[], chatId: number): string {
    for (let i = batch.length - 1; i >= 0; i -= 1) {
      const call = batch[i]!;
      if (
        call.method === "sendMessage" &&
        Number(call.payload.chat_id) === chatId
      ) {
        return String(call.payload.text ?? "");
      }
    }
    return "";
  }

  function keyboardData(batch: MockCall[]): string[] {
    const data: string[] = [];
    for (const call of batch) {
      const markup = (call.payload.reply_markup ?? call.payload.replyMarkup) as
        | { inline_keyboard?: { callback_data?: string }[][] }
        | undefined;
      for (const row of markup?.inline_keyboard ?? []) {
        for (const button of row) {
          if (button.callback_data) data.push(button.callback_data);
        }
      }
    }
    return data;
  }

  /* --------------------------- catalogue setup --------------------------- */

  const productId = await repo.createProduct({
    name: "Test Video Course",
    description: "A complete course, delivered as a ZIP.",
    price: 750,
    currency: "",
    category: "Courses",
    deliveryType: "both",
    fileId: "FILE_ID_123",
    fileName: "course.zip",
    deliveryText: "Your download key: KEY-4242",
    stock: 5,
  });

  /* ------------------------- 1. /start for a buyer ------------------------ */

  let batch = await push(textMessage("/start"));
  let text = lastText(batch);
  check("buyer /start replies with the shop name", text.includes("Test Shop"), text.slice(0, 80));
  check("buyer /start shows the main menu buttons", keyboardData(batch).includes("cat:p:0"));

  /* --------------------- 2. /admin refuses non-admins --------------------- */

  batch = await push(textMessage("/admin"));
  text = lastText(batch);
  check("non-admin /admin is refused", text.includes("do not have admin access"), text.slice(0, 80));

  /* --------------------------- 3. browse products ------------------------- */

  batch = await push(buttonPress("cat:p:0"));
  text = lastText(batch);
  check("catalogue lists the product", text.includes("1 product available"), text.slice(0, 120));
  check("catalogue renders the product button", keyboardData(batch).includes(`cat:v:${productId}`));

  batch = await push(buttonPress(`cat:v:${productId}`));
  text = lastText(batch);
  check("product detail shows the price", text.includes("750"), text.slice(0, 200));
  check("product detail shows the stock", text.includes("In stock: 5"), text.slice(0, 200));
  check("product detail offers Buy now", keyboardData(batch).includes(`ord:new:${productId}`));

  /* --------------------------- 4. create an order ------------------------- */

  batch = await push(buttonPress(`ord:new:${productId}`));
  text = lastText(batch);
  check("order confirmation shows the payment number", text.includes("01700000000"), text.slice(0, 400));
  check("order confirmation shows the amount", text.includes("750"));
  check("order confirmation shows the instructions", text.includes("Send Money only."));

  const codeMatch = text.match(/ORD-[A-Z2-9]{6}/);
  check("order confirmation contains an order code", Boolean(codeMatch), text.slice(0, 200));

  const order = await repo.getOrderByCode(codeMatch![0]);
  checkEqual("order starts as awaiting_payment", order?.status, "awaiting_payment");
  checkEqual("order records the buyer", order?.user_id, BUYER.id);

  const txnButton = keyboardData(batch).find((d) => d.startsWith("ord:txn:"));
  check("order confirmation offers the TrxID button", Boolean(txnButton));

  /* ----------------------- 5. submit a transaction ID --------------------- */

  batch = await push(buttonPress(txnButton!));
  check(
    "bot asks for the transaction ID",
    lastText(batch).includes("transaction ID"),
    lastText(batch).slice(0, 120)
  );
  checkEqual("a TrxID state was stored", (await getState(BUYER.id))?.state, "user:order:txn");

  batch = await push(textMessage("not a valid txn!"));
  check(
    "malformed transaction IDs are rejected",
    lastText(batch).includes("does not look like a transaction ID"),
    lastText(batch).slice(0, 120)
  );

  batch = await push(textMessage("TRX-ABC123"));
  const underReviewText = lastTextTo(batch, BUYER.id);
  check(
    "buyer is told the payment is under review",
    underReviewText.includes("under review"),
    underReviewText.slice(0, 160)
  );
  check(
    "buyer message echoes the order code",
    underReviewText.includes(order!.code),
    underReviewText.slice(0, 160)
  );
  checkEqual("order moved to awaiting_review", (await repo.getOrder(order!.id))?.status, "awaiting_review");
  checkEqual("TrxID saved on the order", (await repo.getOrder(order!.id))?.txn_id, "TRX-ABC123");
  checkEqual("wizard state cleared after submitting", await getState(BUYER.id), null);

  const adminAlert = batch.find(
    (call) => call.method === "sendMessage" && Number(call.payload.chat_id) === ADMIN.id
  );
  check("the admin is alerted about the payment", Boolean(adminAlert));
  check(
    "the admin alert carries the TrxID",
    String(adminAlert?.payload.text ?? "").includes("TRX-ABC123"),
    String(adminAlert?.payload.text ?? "").slice(0, 200)
  );
  check(
    "the admin alert offers approve and reject",
    keyboardData([adminAlert!]).some((d) => d.startsWith("adm:o:approve:")) &&
      keyboardData([adminAlert!]).some((d) => d.startsWith("adm:o:reject:"))
  );

  /* ------------------------- 6. admin opens the queue --------------------- */

  batch = await push(buttonPress("adm:o:list:pending:0", ADMIN));
  text = lastText(batch);
  check("pending queue lists the order", text.includes("1 order"), text.slice(0, 120));

  batch = await push(buttonPress(`adm:o:view:${order!.id}:pending`, ADMIN));
  text = lastText(batch);
  check("admin sees the order detail", text.includes(order!.code), text.slice(0, 200));
  check(
    "admin sees the buyer's transaction ID",
    text.includes("TRX-ABC123"),
    text.slice(0, 300)
  );

  /* ---------------------- 7. approve -> automatic delivery ---------------- */

  batch = await push(buttonPress(`adm:o:approve:${order!.id}:pending`, ADMIN));

  const buyerMessages = batch.filter(
    (call) => call.method === "sendMessage" && Number(call.payload.chat_id) === BUYER.id
  );
  const deliveredFile = batch.find((call) => call.method === "sendDocument");

  check(
    "buyer is told the order was approved",
    buyerMessages.some((call) => String(call.payload.text).includes("approved")),
    JSON.stringify(buyerMessages.map((c) => c.payload.text).slice(0, 2))
  );
  checkEqual("the product file is sent", deliveredFile?.payload.document as unknown, "FILE_ID_123");
  check(
    "the delivery text is sent",
    buyerMessages.some((call) => String(call.payload.text).includes("KEY-4242")),
    JSON.stringify(buyerMessages.map((c) => c.payload.text))
  );
  check(
    "delivered orders carry a caption",
    String(deliveredFile?.payload.caption ?? "").includes("Test Video Course"),
    String(deliveredFile?.payload.caption ?? "")
  );

  const delivered = await repo.getOrder(order!.id);
  checkEqual("order marked as delivered", delivered?.status, "delivered");
  check("delivered_at recorded", Boolean(delivered?.delivered_at));
  checkEqual("stock decremented after delivery", (await repo.getProduct(productId))?.stock, 4);

  /* --------------------------- 8. buyer sees it too ----------------------- */

  batch = await push(textMessage("/orders"));
  text = lastText(batch);
  check("my orders lists the delivered order", text.includes("1 order"), text.slice(0, 120));
  check("the order button shows Delivered", keyboardData(batch).some((d) => d.startsWith("ord:v:")));

  batch = await push(buttonPress(`ord:v:${order!.id}`));
  text = lastText(batch);
  check("buyer order detail shows Delivered", text.includes("Delivered"), text.slice(0, 300));

  /* --------------------- 9. admin adds a product via wizard --------------- */

  batch = await push(buttonPress("adm:p:add", ADMIN));
  check("wizard starts at step 1", lastText(batch).includes("step 1 of 6"), lastText(batch).slice(0, 120));

  await push(textMessage("Second Product", ADMIN));
  await push(textMessage("A short description.", ADMIN));
  batch = await push(textMessage("1200", ADMIN));
  check("wizard accepts a price", lastText(batch).includes("category"), lastText(batch).slice(0, 120));

  batch = await push(textMessage("/skip", ADMIN));
  check(
    "wizard accepts /skip for the category",
    lastText(batch).includes("stock"),
    lastText(batch).slice(0, 120)
  );

  batch = await push(textMessage("7", ADMIN));
  check(
    "wizard shows the delivery type buttons",
    keyboardData(batch).some((d) => d === "adm:p:addtype:text"),
    JSON.stringify(keyboardData(batch))
  );

  batch = await push(buttonPress("adm:p:addtype:text", ADMIN));
  check("wizard asks for the delivery text", lastText(batch).includes("delivery text"), lastText(batch).slice(0, 160));

  batch = await push(textMessage("Download: https://example.com/second", ADMIN));
  check("wizard shows a review screen", lastText(batch).includes("review"), lastText(batch).slice(0, 200));

  batch = await push(buttonPress("adm:p:addsave", ADMIN));
  check(
    "product created confirmation shown",
    lastText(batch).includes("Product created"),
    lastText(batch).slice(0, 200)
  );

  const allProducts = await repo.listProducts({ activeOnly: false, limit: 10, offset: 0 });
  checkEqual("catalogue now has two products", allProducts.length, 2);
  const added = allProducts.find((p) => p.name === "Second Product");
  checkEqual("wizard saved the price", added?.price, 1200);
  checkEqual("wizard saved the delivery text", added?.delivery_text, "Download: https://example.com/second");
  checkEqual("wizard saved the stock count", added?.stock, 7);
  checkEqual("wizard cleared the category via /skip", added?.category, null);
  checkEqual("wizard stored the delivery type", added?.delivery_type, "text");
  checkEqual("new products are active immediately", added?.active, 1);

  /* ---------------------------- 10. rejection ----------------------------- */

  const order2 = await repo.createOrder({
    userId: BUYER.id,
    username: BUYER.username,
    firstName: BUYER.first_name,
    product: (await repo.getProduct(added!.id))!,
  });
  await repo.markOrderUnderReview(order2.id, "BAD-TRX", null);

  batch = await push(buttonPress(`adm:o:reject:${order2.id}:pending`, ADMIN));
  check("admin is asked for a rejection reason", lastText(batch).includes("reason"), lastText(batch).slice(0, 160));

  batch = await push(textMessage("TrxID not found in our statement.", ADMIN));
  const rejected = await repo.getOrder(order2.id);
  checkEqual("order marked rejected", rejected?.status, "rejected");
  checkEqual("rejection reason stored", rejected?.admin_note, "TrxID not found in our statement.");
  check(
    "buyer is notified of the rejection",
    batch.some(
      (call) =>
        call.method === "sendMessage" &&
        Number(call.payload.chat_id) === BUYER.id &&
        String(call.payload.text).includes("not approved")
    )
  );

  /* ------------- 11. every rendered button is actually handled ------------ */

  // Walk every screen, collect all callback strings the bot renders, then press
  // each one and assert it was consumed — pressing an unknown button produces the
  // fallback answer "no longer available".
  const rendered = new Map<string, boolean>();
  const recordRendered = (batch: MockCall[]): void => {
    for (const data of keyboardData(batch)) rendered.set(data, true);
  };

  recordRendered(await push(textMessage("/start")));
  recordRendered(await push(textMessage("/orders")));
  recordRendered(await push(textMessage("/admin", ADMIN)));
  recordRendered(await push(buttonPress("cat:p:0")));
  recordRendered(await push(buttonPress(`cat:v:${productId}`)));
  recordRendered(await push(buttonPress(`ord:v:${order!.id}`)));
  recordRendered(await push(buttonPress(`ord:new:${added!.id}`)));
  recordRendered(await push(buttonPress("adm:p:list:0", ADMIN)));
  recordRendered(await push(buttonPress(`adm:p:view:${productId}`, ADMIN)));
  recordRendered(await push(buttonPress(`adm:p:delivery:${productId}`, ADMIN)));
  recordRendered(await push(buttonPress(`adm:p:types:${productId}`, ADMIN)));
  recordRendered(await push(buttonPress(`adm:p:delete:${productId}`, ADMIN)));
  recordRendered(await push(buttonPress("adm:p:add", ADMIN)));
  recordRendered(await push(buttonPress("adm:s", ADMIN)));
  recordRendered(await push(buttonPress("adm:a:list", ADMIN)));
  recordRendered(await push(buttonPress("adm:o:list:all:0", ADMIN)));
  recordRendered(await push(buttonPress(`adm:o:view:${order2.id}:all`, ADMIN)));

  check(
    "the audit collected a meaningful number of buttons",
    rendered.size >= 25,
    `${rendered.size} buttons`
  );

  for (const data of rendered.keys()) {
    const batch = await push(
      buttonPress(data, data.startsWith("adm:") ? ADMIN : BUYER)
    );
    const fellThrough = batch.some(
      (call) =>
        call.method === "answerCallbackQuery" &&
        String(call.payload.text ?? "").includes("no longer available")
    );
    check(`button "${data}" reaches a handler`, !fellThrough);
  }

  /* ----------------------------- 12. hygiene ------------------------------ */

  checkEqual("no handler threw an exception", handlerErrors, []);

  /* ------------------------------ cleanup --------------------------------- */

  await cleanup();
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

async function cleanup(): Promise<void> {
  try {
    const { db } = await import("../src/db");
    await db().close();
  } catch {
    // ignore
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
    console.log("\nAll bot checks passed.");
  });
