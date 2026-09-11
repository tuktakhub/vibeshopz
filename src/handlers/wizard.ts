import { InlineKeyboard, type Bot, type Context } from "grammy";
import { addAdmin, isAdmin } from "../admins";
import { notifyAdmins, safeSend } from "../notify";
import {
  createPaymentMethod,
  createProduct,
  getDeposit,
  getOrder,
  getPaymentMethod,
  getProduct,
  markDepositRejected,
  markDepositUnderReview,
  markOrderRejected,
  markOrderUnderReview,
  updatePaymentMethod,
  updateProduct,
} from "../repository";
import { setSetting } from "../settings";
import {
  ADD_PRODUCT_STATES,
  ADMIN_STATES,
  clearState,
  getState,
  setState,
  USER_STATES,
  type UserState,
} from "../state";
import type { DeliveryType } from "../types";
import {
  escapeHtml,
  formatMoney,
  isNumeric,
} from "../utils";
import * as kb from "../keyboards";
import * as t from "../texts";
import { HTML_PARSE_MODE, sendHtml } from "./render";
import { bindWizardHandlers, ADMIN_PRODUCT_FILE_STATE } from "./admin";
import { startDeposit } from "./customer";

const HTML = {
  parse_mode: HTML_PARSE_MODE,
  link_preview_options: { is_disabled: true },
};

interface ProductDraft {
  name?: string;
  description?: string;
  price?: number;
  category?: string | null;
  stock?: number | null;
  deliveryType?: DeliveryType;
  fileId?: string | null;
  fileName?: string | null;
  deliveryText?: string | null;
}

function answer(ctx: Context, text: string): Promise<unknown> {
  return ctx.reply(text, HTML);
}

function nudgeOff(ctx: Context, hint: string, keyboard?: InlineKeyboard) {
  return ctx.reply(hint, { ...HTML, reply_markup: keyboard });
}

/* ------------------------- add product wizard --------------------------- */

const TOTAL_STEPS = 6;

function draftSummary(draft: ProductDraft): string {
  return [
    "<b>New product — review</b>",
    "",
    `Name: <b>${escapeHtml(draft.name ?? "")}</b>`,
    `Price: <b>${formatMoney(draft.price ?? 0)}</b>`,
    `Category: ${escapeHtml(draft.category ?? "—")}`,
    `Stock: ${draft.stock === null || draft.stock === undefined ? "unlimited" : draft.stock}`,
    `Delivery: ${escapeHtml(draft.deliveryType ?? "—")}`,
    `File: ${draft.fileId ? escapeHtml(draft.fileName ?? "attached") : "—"}`,
    `Text: ${draft.deliveryText ? "set" : "—"}`,
    "",
    "Save this product? It becomes visible in the catalogue immediately.",
  ].join("\n");
}

function draftSummaryKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Save product", "adm:p:addsave")
    .row()
    .text("Cancel", "adm:p:addcancel");
}

async function onAddType(ctx: Context, type: string): Promise<void> {
  const userId = ctx.from!.id;
  const state = await getState<{ draft: ProductDraft }>(userId);

  if (!state || !state.state.startsWith("admin:product:add")) {
    await ctx.answerCallbackQuery("This wizard expired. Start again from /admin.");
    return;
  }
  if (type !== "file" && type !== "text" && type !== "both") {
    await ctx.answerCallbackQuery("Unknown delivery type.");
    return;
  }

  const draft: ProductDraft = { ...state.data.draft, deliveryType: type };
  await ctx.answerCallbackQuery("Noted");

  if (type === "text") {
    await setState(userId, ADD_PRODUCT_STATES.text, { draft });
    await sendHtml(
      ctx,
      `<b>Step 5 of ${TOTAL_STEPS}</b>\n\nSend the <b>delivery text</b> — a download link, licence key or instructions.\n\nSend /cancel to stop.`
    );
  } else {
    await setState(userId, ADD_PRODUCT_STATES.file, { draft });
    await sendHtml(
      ctx,
      `<b>Step 5 of ${TOTAL_STEPS}</b>\n\nSend the <b>file</b> the buyer should receive — as a document, not a photo.\n\nSend /cancel to stop.`
    );
  }
}

async function onAddSave(ctx: Context, _adminId: number): Promise<void> {
  const userId = ctx.from!.id;
  const state = await getState<{ draft: ProductDraft }>(userId);

  if (!state || state.state !== ADD_PRODUCT_STATES.confirm) {
    await ctx.answerCallbackQuery("This wizard expired. Start again from /admin.");
    return;
  }

  const draft = state.data.draft;
  if (!draft.name || draft.price === undefined || !draft.deliveryType) {
    await ctx.answerCallbackQuery("Some details are missing.");
    return;
  }

  const id = await createProduct({
    name: draft.name,
    description: draft.description ?? "",
    price: draft.price,
    currency: "",
    category: draft.category ?? null,
    deliveryType: draft.deliveryType,
    fileId: draft.fileId ?? null,
    fileName: draft.fileName ?? null,
    deliveryText: draft.deliveryText ?? null,
    stock: draft.stock ?? null,
  });

  const product = await getProduct(id);
  await clearState(userId);
  await ctx.answerCallbackQuery("Product created");

  if (!product) {
    await sendHtml(ctx, "Product saved, but it could not be read back.", kb.backToAdminKeyboard());
    return;
  }

  await sendHtml(
    ctx,
    t.adminProductCreated(product),
    new InlineKeyboard()
      .text("Open product", `adm:p:view:${product.id}`)
      .row()
      .text("« Admin menu", "adm:home")
  );
}

/* ------------------------------ text router ----------------------------- */

async function finishEdit(ctx: Context, productId: number, note: string) {
  await clearState(ctx.from!.id);
  await sendHtml(
    ctx,
    note,
    new InlineKeyboard()
      .text("« Back to product", `adm:p:view:${productId}`)
      .row()
      .text("« Admin menu", "adm:home")
  );
}

async function routeText(ctx: Context, state: UserState, text: string): Promise<void> {
  const userId = ctx.from!.id;
  const { state: name, data } = state;
  const trimmed = text.trim();
  const isSkip = trimmed.toLowerCase() === "/skip";

  /* -------------------------- buyer: TrxID ---------------------------- */

  if (name === USER_STATES.submitTxn) {
    const orderId = Number(data.orderId ?? 0);
    if (!/^[A-Za-z0-9._-]{4,64}$/.test(trimmed)) {
      await answer(ctx, t.invalidTxnId());
      return;
    }

    const order = await getOrder(orderId);
    if (!order || order.user_id !== userId) {
      await clearState(userId);
      await answer(ctx, "That order could not be found. Use /orders to see your orders.");
      return;
    }
    if (order.status === "delivered") {
      await clearState(userId);
      await answer(ctx, "That order was already delivered.");
      return;
    }
    if (order.status === "cancelled") {
      await clearState(userId);
      await answer(ctx, "That order was cancelled. Please place a new one from /products.");
      return;
    }

    await markOrderUnderReview(order.id, trimmed, null);
    await clearState(userId);

    const fresh = (await getOrder(order.id)) ?? order;
    await answer(ctx, t.txnReceived(fresh));
    await notifyAdmins(t.adminNewPayment(fresh), kb.adminOrderKeyboard(fresh, "pending"));
    return;
  }

  /* ------------------------ buyer: deposit amount ---------------------- */

  if (name === USER_STATES.depositAmount) {
    const amount = Number.parseFloat(trimmed);

    if (!isNumeric(trimmed) || !Number.isFinite(amount)) {
      await nudgeOff(ctx, "Please send the amount as a number, for example 500.");
      return;
    }

    await startDeposit(ctx, amount, Number(data.methodId ?? 0));
    return;
  }

  /* ------------------------- buyer: deposit TrxID ---------------------- */

  if (name === USER_STATES.depositTxn) {
    const depositId = Number(data.depositId ?? 0);

    if (!/^[A-Za-z0-9._-]{4,64}$/.test(trimmed)) {
      await answer(ctx, t.invalidTrxId());
      return;
    }

    const deposit = await getDeposit(depositId);
    if (!deposit || deposit.user_id !== userId) {
      await clearState(userId);
      await answer(ctx, "That deposit could not be found. Open /wallet to try again.");
      return;
    }
    if (deposit.status === "approved") {
      await clearState(userId);
      await answer(ctx, "That deposit was already credited to your wallet.");
      return;
    }
    if (deposit.status === "cancelled" || deposit.status === "rejected") {
      await clearState(userId);
      await answer(ctx, "That deposit is closed. Open /wallet to start a new one.");
      return;
    }

    await markDepositUnderReview(deposit.id, trimmed);
    await clearState(userId);

    const freshDeposit = (await getDeposit(deposit.id)) ?? deposit;
    await answer(ctx, t.depositSubmitted(freshDeposit));
    await notifyAdmins(t.adminNewDeposit(freshDeposit), kb.adminDepositKeyboard(freshDeposit));
    return;
  }

  /* --------------------------- admin states --------------------------- */

  if (!name.startsWith("admin:")) {
    await clearState(userId);
    return;
  }

  if (!(await isAdmin(userId))) {
    await clearState(userId);
    return;
  }

  /* --- add product wizard --- */

  const draft: ProductDraft = { ...((data.draft as ProductDraft | undefined) ?? {}) };

  if (name === ADD_PRODUCT_STATES.name) {
    if (trimmed.length < 2) {
      await nudgeOff(ctx, "That name is too short. Send the product name again.");
      return;
    }
    draft.name = trimmed;
    await setState(userId, ADD_PRODUCT_STATES.description, { draft });
    await sendHtml(
      ctx,
      `<b>Step 2 of ${TOTAL_STEPS}</b>\n\nSend the product <b>description</b> buyers will read, or /skip.`
    );
    return;
  }

  if (name === ADD_PRODUCT_STATES.description) {
    draft.description = isSkip ? "" : trimmed;
    await setState(userId, ADD_PRODUCT_STATES.price, { draft });
    await sendHtml(
      ctx,
      `<b>Step 3 of ${TOTAL_STEPS}</b>\n\nSend the <b>price</b> as a number, for example <code>499</code>.`
    );
    return;
  }

  if (name === ADD_PRODUCT_STATES.price) {
    if (!isNumeric(trimmed) || Number(trimmed) < 0) {
      await nudgeOff(ctx, "Please send the price as a plain number, for example 499.");
      return;
    }
    draft.price = Number(trimmed);
    await setState(userId, ADD_PRODUCT_STATES.category, { draft });
    await sendHtml(
      ctx,
      `<b>Step 4 of ${TOTAL_STEPS}</b>\n\nSend a <b>category</b> (for example “Templates”), or /skip.`
    );
    return;
  }

  if (name === ADD_PRODUCT_STATES.category) {
    draft.category = isSkip ? null : trimmed;
    await setState(userId, ADD_PRODUCT_STATES.stock, { draft });
    await sendHtml(
      ctx,
      `<b>Step 5 of ${TOTAL_STEPS}</b>\n\nSend the <b>stock</b> as a whole number, or send <code>unlimited</code> / /skip for unlimited stock.`
    );
    return;
  }

  if (name === ADD_PRODUCT_STATES.stock) {
    if (isSkip || trimmed.toLowerCase() === "unlimited") {
      draft.stock = null;
    } else if (/^\d+$/.test(trimmed)) {
      draft.stock = Number.parseInt(trimmed, 10);
    } else {
      await nudgeOff(ctx, "Send a whole number, or send unlimited.");
      return;
    }
    await setState(userId, ADD_PRODUCT_STATES.deliveryType, { draft });
    await sendHtml(
      ctx,
      `<b>Step 6 of ${TOTAL_STEPS}</b>\n\nWhat should the buyer receive after their payment is approved?`,
      kb.deliveryTypeKeyboard(null, "adm:p:addtype")
    );
    return;
  }

  if (name === ADD_PRODUCT_STATES.deliveryType) {
    await nudgeOff(
      ctx,
      "Please tap one of the buttons below to choose the delivery type.",
      kb.deliveryTypeKeyboard(null, "adm:p:addtype")
    );
    return;
  }

  if (name === ADD_PRODUCT_STATES.text) {
    if (trimmed.length < 2) {
      await nudgeOff(ctx, "That is too short. Send the delivery text again.");
      return;
    }
    draft.deliveryText = text.trim();
    await setState(userId, ADD_PRODUCT_STATES.confirm, { draft });
    await sendHtml(ctx, draftSummary(draft), draftSummaryKeyboard());
    return;
  }

  if (name === ADD_PRODUCT_STATES.file) {
    await nudgeOff(
      ctx,
      "Please send the file itself, as a document attachment (not a photo, not a link)."
    );
    return;
  }

  if (name === ADD_PRODUCT_STATES.confirm) {
    await nudgeOff(ctx, "Tap “Save product” below, or Cancel.", draftSummaryKeyboard());
    return;
  }

  /* --- edit an existing product --- */

  if (name === ADMIN_STATES.editProduct) {
    const productId = Number(data.productId ?? 0);
    const field = String(data.field ?? "");
    const product = await getProduct(productId);
    if (!product) {
      await clearState(userId);
      await answer(ctx, "That product no longer exists.");
      return;
    }

    switch (field) {
      case "name": {
        if (trimmed.length < 2) {
          await nudgeOff(ctx, "That name is too short. Send it again.");
          return;
        }
        await updateProduct(productId, { name: trimmed });
        await finishEdit(ctx, productId, "Product name updated.");
        return;
      }
      case "description": {
        await updateProduct(productId, { description: isSkip ? "" : trimmed });
        await finishEdit(ctx, productId, "Description updated.");
        return;
      }
      case "price": {
        if (!isNumeric(trimmed)) {
          await nudgeOff(ctx, "Send the price as a plain number, for example 499.");
          return;
        }
        await updateProduct(productId, { price: Number(trimmed) });
        await finishEdit(
          ctx,
          productId,
          `Price updated to <b>${formatMoney(Number(trimmed))}</b>.`
        );
        return;
      }
      case "category": {
        await updateProduct(productId, { category: isSkip ? null : trimmed });
        await finishEdit(ctx, productId, "Category updated.");
        return;
      }
      case "stock": {
        if (isSkip || trimmed.toLowerCase() === "unlimited") {
          await updateProduct(productId, { stock: null });
          await finishEdit(ctx, productId, "Stock set to <b>unlimited</b>.");
          return;
        }
        if (!/^\d+$/.test(trimmed)) {
          await nudgeOff(ctx, "Send a whole number, or send unlimited.");
          return;
        }
        await updateProduct(productId, { stock: Number.parseInt(trimmed, 10) });
        await finishEdit(ctx, productId, `Stock set to <b>${trimmed}</b>.`);
        return;
      }
      case "deliveryText": {
        if (trimmed.length < 2) {
          await nudgeOff(ctx, "That is too short. Send the delivery text again.");
          return;
        }
        await updateProduct(productId, { deliveryText: text.trim() });
        await finishEdit(ctx, productId, "Delivery text updated.");
        return;
      }
      default: {
        await clearState(userId);
        await answer(ctx, "That edit is no longer supported. Open the product again from /admin.");
        return;
      }
    }
  }

  /* --- reject a wallet deposit --- */

  if (name === ADMIN_STATES.depositReject) {
    const deposit = await getDeposit(Number(data.depositId ?? 0));

    if (!deposit) {
      await clearState(userId);
      await answer(ctx, "That deposit no longer exists.");
      return;
    }
    if (trimmed.length < 2) {
      await nudgeOff(ctx, "Please send a short reason the buyer will understand.");
      return;
    }

    await markDepositRejected(deposit.id, trimmed);
    await clearState(userId);

    const freshDeposit = (await getDeposit(deposit.id)) ?? deposit;
    await safeSend(freshDeposit.user_id, t.depositRejected(freshDeposit, trimmed), {
      parse_mode: "HTML",
    });
    await sendHtml(
      ctx,
      `<b>Deposit ${escapeHtml(freshDeposit.code)} rejected.</b>\n\n` +
        `The buyer has been notified with your reason.`,
      new InlineKeyboard().text("« Back to deposits", "adm:d:list:0")
    );
    return;
  }

  /* --- reject an order --- */

  if (name === ADMIN_STATES.orderReject) {
    const orderId = Number(data.orderId ?? 0);
    const scope = data.scope === "all" ? "all" : "pending";

    const order = await getOrder(orderId);
    if (!order) {
      await clearState(userId);
      await answer(ctx, "That order no longer exists.");
      return;
    }
    if (trimmed.length < 2) {
      await nudgeOff(ctx, "Please send a short reason the buyer will understand.");
      return;
    }

    await markOrderRejected(order.id, trimmed);
    await clearState(userId);

    const fresh = (await getOrder(order.id)) ?? order;
    await safeSend(fresh.user_id, t.txnRejectedNotice(fresh));
    await sendHtml(
      ctx,
      `<b>Order ${escapeHtml(fresh.code)} rejected.</b>\n\nThe buyer has been notified with your reason.`,
      new InlineKeyboard()
        .text("« Back to orders", `adm:o:list:${scope}:0`)
        .row()
        .text("« Admin menu", "adm:home")
    );
    return;
  }

  /* --- add a payment method (name → icon → details) --- */

  if (name === ADMIN_STATES.methodAdd) {
    const step = String(data.step ?? "name");
    const draft = {
      name: String(data.name ?? ""),
      emoji: String(data.emoji ?? "💳"),
    };

    if (step === "name") {
      if (trimmed.length < 2) {
        await nudgeOff(ctx, "That name is too short. Send the payment method name again.");
        return;
      }
      await setState(userId, ADMIN_STATES.methodAdd, { step: "emoji", name: trimmed });
      await sendHtml(
        ctx,
        `<b>New payment method — step 2 of 3</b>\n\n` +
          `Send a single <b>emoji</b> to use as its icon, for example 💵.\n\n` +
          `Send /skip to use the default 💳.`
      );
      return;
    }

    if (step === "emoji") {
      const emoji = isSkip ? "💳" : trimmed;
      if (emoji.length > 8) {
        await nudgeOff(ctx, "Send just one emoji, or /skip for the default 💳.");
        return;
      }
      await setState(userId, ADMIN_STATES.methodAdd, {
        step: "instructions",
        name: draft.name,
        emoji,
      });
      await sendHtml(
        ctx,
        `<b>New payment method — step 3 of 3</b>\n\n` +
          `Send the <b>payment details</b> buyers will follow — wallet address, ` +
          `account number or instructions. Line breaks are kept.`
      );
      return;
    }

    if (step === "instructions") {
      if (trimmed.length < 2) {
        await nudgeOff(ctx, "That is too short. Send the payment details again.");
        return;
      }

      const methodId = await createPaymentMethod({
        name: draft.name,
        emoji: draft.emoji,
        instructions: text.trim(),
      });
      await clearState(userId);

      const created = await getPaymentMethod(methodId);
      if (!created) {
        await answer(ctx, "The method could not be saved. Open /admin and try again.");
        return;
      }
      await sendHtml(
        ctx,
        `<b>Payment method added.</b>\n\n${t.adminMethodDetail(created)}`,
        kb.adminMethodKeyboard(created)
      );
      return;
    }

    await clearState(userId);
    await answer(ctx, "That step expired. Open /admin and start again.");
    return;
  }

  /* --- edit one field of a payment method --- */

  if (name === ADMIN_STATES.methodEdit) {
    const methodId = Number(data.methodId ?? 0);
    const field = String(data.field ?? "");
    const method = await getPaymentMethod(methodId);

    if (!method) {
      await clearState(userId);
      await answer(ctx, "That payment method no longer exists.");
      return;
    }

    if (field === "name" && trimmed.length < 2) {
      await nudgeOff(ctx, "That name is too short. Send it again.");
      return;
    }
    if (field === "emoji" && trimmed.length > 8) {
      await nudgeOff(ctx, "Send just one emoji.");
      return;
    }
    if (field === "instructions" && trimmed.length < 2) {
      await nudgeOff(ctx, "That is too short. Send the payment details again.");
      return;
    }
    if (field !== "name" && field !== "emoji" && field !== "instructions") {
      await clearState(userId);
      await answer(ctx, "That edit is no longer supported. Open the method again from /admin.");
      return;
    }

    const value = field === "instructions" ? text.trim() : trimmed;
    await updatePaymentMethod(methodId, { [field]: value });
    await clearState(userId);

    const fresh = (await getPaymentMethod(methodId)) ?? method;
    await sendHtml(
      ctx,
      `<b>Saved.</b>\n\n${t.adminMethodDetail(fresh)}`,
      kb.adminMethodKeyboard(fresh)
    );
    return;
  }

  /* --- change a setting --- */

  if (name === ADMIN_STATES.setting) {
    const key = String(data.key ?? "");
    if (!key) {
      await clearState(userId);
      return;
    }
    await setSetting(key, isSkip ? "" : trimmed);
    await clearState(userId);
    await sendHtml(
      ctx,
      `<b>Saved.</b> <code>${escapeHtml(key)}</code> is now up to date for buyers.`,
      kb.adminSettingsKeyboard()
    );
    return;
  }

  /* --- add an admin --- */

  if (name === ADMIN_STATES.addAdmin) {
    if (!/^\d{4,}$/.test(trimmed)) {
      await nudgeOff(
        ctx,
        "That is not a Telegram user ID. It must be digits only — the user can get it by sending /id to this bot."
      );
      return;
    }
    await addAdmin(Number(trimmed), userId);
    await clearState(userId);
    await sendHtml(
      ctx,
      `<b>Admin added:</b> <code>${escapeHtml(trimmed)}</code>`,
      kb.backToAdminKeyboard()
    );
    return;
  }

  /* --- waiting for a file on an existing product --- */

  if (name === ADMIN_PRODUCT_FILE_STATE) {
    await nudgeOff(ctx, "Please send the file as a document attachment.");
    return;
  }

  // Unknown or stale state.
  await clearState(userId);
  await sendHtml(
    ctx,
    "That step is no longer active. Open /admin and try again.",
    kb.backToAdminKeyboard()
  );
}

/* ---------------------------- document router --------------------------- */

async function routeDocument(ctx: Context, state: UserState): Promise<void> {
  const userId = ctx.from!.id;
  const { state: name, data } = state;
  const document = ctx.message!.document!;

  if (!name.startsWith("admin:") || !(await isAdmin(userId))) {
    await clearState(userId);
    await answer(
      ctx,
      "I was not expecting a file here. Send your transaction ID as text, or use /products to order."
    );
    return;
  }

  if (name === ADD_PRODUCT_STATES.file) {
    const draft: ProductDraft = {
      ...((data.draft as ProductDraft | undefined) ?? {}),
      fileId: document.file_id,
      fileName: document.file_name ?? "product-file",
    };

    if (draft.deliveryType === "both") {
      await setState(userId, ADD_PRODUCT_STATES.text, { draft });
      await sendHtml(
        ctx,
        `<b>File saved.</b>\n\nNow send the <b>delivery text</b> — a download link, licence key or instructions.\n\nSend /cancel to stop.`
      );
      return;
    }

    await setState(userId, ADD_PRODUCT_STATES.confirm, { draft });
    await sendHtml(ctx, draftSummary(draft), draftSummaryKeyboard());
    return;
  }

  if (name === ADMIN_PRODUCT_FILE_STATE) {
    const productId = Number(data.productId ?? 0);
    await updateProduct(productId, {
      fileId: document.file_id,
      fileName: document.file_name ?? "product-file",
    });
    await finishEdit(ctx, productId, "File replaced. Buyers now receive this file.");
    return;
  }

  await nudgeOff(
    ctx,
    "I was not expecting a file right now. Follow the instruction above, or send /cancel."
  );
}

/* ------------------------------ registration ---------------------------- */

export function registerWizardHandlers(bot: Bot): void {
  bindWizardHandlers({ onAddType, onAddSave });

  bot.on("message:text", async (ctx, next) => {
    const from = ctx.from;
    if (!from) return next();

    const state = await getState(from.id);
    if (!state) return next();

    const text = ctx.message.text;
    if (text.startsWith("/") && !/^\/skip\b/i.test(text)) {
      // Let real commands (including /cancel) run their own handlers.
      return next();
    }

    await routeText(ctx, state, text);
  });

  bot.on("message:document", async (ctx, next) => {
    const from = ctx.from;
    if (!from) return next();

    const state = await getState(from.id);
    if (!state) return next();

    await routeDocument(ctx, state);
  });
}
