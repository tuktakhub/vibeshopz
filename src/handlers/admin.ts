import { InlineKeyboard, type Bot, type Context } from "grammy";
import { addAdmin, isAdmin, listAdmins, removeAdmin } from "../admins";
import { deliverOrder } from "../delivery";
import { getShopInfo, setSetting } from "../settings";
import {
  countDeliveredRevenue,
  countOrders,
  countProducts,
  deleteProduct,
  getOrder,
  getProduct,
  listOrders,
  listProducts,
  updateProduct,
} from "../repository";
import type { SettingKey } from "../schema";
import {
  ADD_PRODUCT_STATES,
  ADMIN_STATES,
  clearState,
  setState,
} from "../state";
import type { Order, Product } from "../types";
import { clampPage, escapeHtml, pageCount } from "../utils";
import * as kb from "../keyboards";
import * as t from "../texts";
import { render, sendHtml } from "./render";

/* ---------------------------- shared helpers ---------------------------- */

/** Pseudo-state used while waiting for a document to attach to a product. */
export const ADMIN_PRODUCT_FILE_STATE = "admin:product:file";

async function guardAdmin(ctx: Context): Promise<boolean> {
  const from = ctx.from;
  if (!from) return false;
  if (await isAdmin(from.id)) return true;

  await ctx.answerCallbackQuery({
    text: "This area is for shop admins only.",
    show_alert: true,
  });
  return false;
}

async function showAdminHome(ctx: Context): Promise<void> {
  const [products, pending, delivered, revenue] = await Promise.all([
    countProducts(false),
    countOrders(["awaiting_payment", "awaiting_review"]),
    countOrders(["delivered"]),
    countDeliveredRevenue(),
  ]);

  await render(
    ctx,
    t.adminPanel({ products, pending, delivered, revenue }),
    kb.adminMenu()
  );
}

/* ------------------------------- products ------------------------------- */

async function showProductList(ctx: Context, page: number): Promise<void> {
  const total = await countProducts(false);
  if (total === 0) {
    await render(
      ctx,
      "<b>Products</b>\n\nNo products yet. Add your first one and it appears in the catalogue immediately.",
      new InlineKeyboard()
        .text("+ Add product", "adm:p:add")
        .row()
        .text("« Admin menu", "adm:home")
    );
    return;
  }

  const totalPages = pageCount(total, 10);
  const current = clampPage(page, totalPages);
  const products = await listProducts({
    activeOnly: false,
    limit: 10,
    offset: current * 10,
  });

  await render(
    ctx,
    `<b>Products</b>\n\n${total} product${total === 1 ? "" : "s"} in the catalogue.`,
    kb.adminProductsKeyboard(products, current, totalPages)
  );
}

async function showProductDetail(ctx: Context, productId: number): Promise<void> {
  const product = await getProduct(productId);
  if (!product) {
    await render(
      ctx,
      "That product no longer exists.",
      kb.adminProductsKeyboard([], 0, 1)
    );
    return;
  }
  await render(ctx, t.adminProductDetail(product), kb.adminProductKeyboard(product));
}

async function showDeliveryScreen(ctx: Context, productId: number): Promise<void> {
  const product = await getProduct(productId);
  if (!product) {
    await render(ctx, "That product no longer exists.", kb.adminProductsKeyboard([], 0, 1));
    return;
  }

  const fileLine = product.file_id
    ? `<code>${escapeHtml(product.file_name ?? "attached")}</code>`
    : "—";
  const textLine = product.delivery_text
    ? `<code>${escapeHtml(product.delivery_text.slice(0, 200))}</code>`
    : "—";

  await render(
    ctx,
    `<b>#${product.id} — delivery content</b>\n\n` +
      `Type: <b>${escapeHtml(product.delivery_type)}</b>\n` +
      `File: ${fileLine}\n` +
      `Text: ${textLine}\n\n` +
      `The buyer receives exactly this after you approve their payment.`,
    kb.adminDeliveryKeyboard(product.id)
  );
}

/* -------------------------------- orders -------------------------------- */

const PENDING_STATUSES = ["awaiting_payment", "awaiting_review"] as const;

async function showOrderList(
  ctx: Context,
  scope: "pending" | "all",
  page: number
): Promise<void> {
  const statuses = scope === "pending" ? [...PENDING_STATUSES] : undefined;
  const total = await countOrders(statuses);
  const totalPages = pageCount(total, 8);
  const current = clampPage(page, totalPages);
  const orders = await listOrders({
    statuses,
    limit: 8,
    offset: current * 8,
  });

  await render(
    ctx,
    t.adminOrdersHeader(scope, total),
    kb.adminOrdersKeyboard(orders, scope, current, totalPages)
  );
}

async function showOrderDetail(
  ctx: Context,
  orderId: number,
  scope: "pending" | "all"
): Promise<void> {
  const order = await getOrder(orderId);
  if (!order) {
    await render(ctx, "That order no longer exists.", kb.adminOrdersKeyboard([], scope, 0, 1));
    return;
  }
  await render(ctx, t.adminOrderDetail(order), kb.adminOrderKeyboard(order, scope));
}

async function approveOrder(
  ctx: Context,
  orderId: number,
  scope: "pending" | "all",
  adminId: number
): Promise<void> {
  const order = await getOrder(orderId);
  if (!order) {
    await ctx.answerCallbackQuery("Order not found.");
    return;
  }
  if (order.status === "delivered") {
    await ctx.answerCallbackQuery("This order was already delivered.");
    return;
  }
  if (order.status === "cancelled") {
    await ctx.answerCallbackQuery("This order was cancelled.");
    return;
  }

  await ctx.answerCallbackQuery("Approving and delivering...");
  const result = await deliverOrder(order);
  const fresh = (await getOrder(order.id)) ?? order;

  const footer = result.ok
    ? `<b>${result.ok ? "Delivered" : "Failed"}</b>${
        result.error
          ? `\n\n<b>Note:</b> ${escapeHtml(result.error)}`
          : `\n\nHandled by admin <code>${adminId}</code>.`
      }`
    : `<b>Delivery failed</b>\n\n${escapeHtml(result.error ?? "Unknown error")}\n\nThe order is still marked as under review — fix the product and approve again.`;

  await render(
    ctx,
    `${t.adminOrderDetail(fresh)}\n\n${footer}`,
    kb.adminOrderKeyboard(fresh, scope)
  );
}

/* ------------------------------- settings ------------------------------- */

const SETTING_LABELS: Record<SettingKey, string> = {
  shop_name: "Shop name",
  support_username: "Support username",
  payment_method_name: "Payment method",
  payment_number: "Payment number",
  payment_instructions: "Payment instructions",
  payment_note: "Payment note",
};

const SETTING_PROMPTS: Record<SettingKey, string> = {
  shop_name: "Send the new shop name.",
  support_username: "Send the support username (for example @yourname), or /skip to clear it.",
  payment_method_name: "Send the payment method name shown to buyers (for example bKash, Nagad, Upay).",
  payment_number: "Send the number buyers should pay to.",
  payment_instructions: "Send the payment instructions shown at checkout.",
  payment_note: "Send the short reminder shown under the payment details, or /skip to clear it.",
};

function isSettingKey(value: string): value is SettingKey {
  return Object.prototype.hasOwnProperty.call(SETTING_LABELS, value);
}

async function showSettings(ctx: Context): Promise<void> {
  const shop = await getShopInfo();
  await render(ctx, t.adminSettings(shop), kb.adminSettingsKeyboard());
}

async function showAdmins(ctx: Context): Promise<void> {
  const ids = await listAdmins();
  await render(ctx, t.adminAdmins(ids), kb.adminAdminsKeyboard(ids));
}

/* ------------------------------ registration ---------------------------- */

export function registerAdminHandlers(bot: Bot): void {
  bot.command("admin", async (ctx) => {
    if (!(await isAdmin(ctx.from!.id))) {
      await ctx.reply(
        `You do not have admin access.\n\nYour Telegram ID is <code>${ctx.from!.id}</code>. ` +
          `Add it to ADMIN_IDS and redeploy, or ask an existing admin to add you from /admin.`,
        { parse_mode: "HTML" }
      );
      return;
    }
    await clearState(ctx.from!.id);
    await showAdminHome(ctx);
  });

  bot.callbackQuery(/^adm:/, async (ctx) => {
    if (!(await guardAdmin(ctx))) return;

    const parts = ctx.callbackQuery.data.split(":");
    const section = parts[1] ?? "";
    const action = parts[2] ?? "";
    const adminId = ctx.from.id;

    /* ------------------------------- home ------------------------------- */
    if (section === "home") {
      await ctx.answerCallbackQuery();
      await showAdminHome(ctx);
      return;
    }

    /* ----------------------------- products ----------------------------- */
    if (section === "p") {
      if (action === "list") {
        await ctx.answerCallbackQuery();
        await showProductList(ctx, Number.parseInt(parts[3] ?? "0", 10));
        return;
      }

      if (action === "view") {
        await ctx.answerCallbackQuery();
        await showProductDetail(ctx, Number.parseInt(parts[3] ?? "0", 10));
        return;
      }

      if (action === "add") {
        await setState(ctx.from.id, ADD_PRODUCT_STATES.name, { draft: {} });
        await ctx.answerCallbackQuery();
        await sendHtml(
          ctx,
          "<b>New product — step 1 of 6</b>\n\nSend the product <b>name</b> as the buyer should see it.\n\nSend /cancel to stop.",
          kb.cancelActionKeyboard("adm:p:addcancel")
        );
        return;
      }

      if (action === "addcancel") {
        await clearState(ctx.from.id);
        await ctx.answerCallbackQuery("Cancelled");
        await showAdminHome(ctx);
        return;
      }

      if (action === "field") {
        const productId = Number.parseInt(parts[3] ?? "0", 10);
        const field = parts[4] ?? "";
        const prompts: Record<string, string> = {
          name: "Send the new product <b>name</b>.",
          description: "Send the new <b>description</b>, or /skip to clear it.",
          price: "Send the new <b>price</b> as a number (for example 499).",
          category: "Send the new <b>category</b>, or /skip to clear it.",
          stock:
            "Send the new <b>stock</b> count as a whole number, or send <code>unlimited</code>.",
        };
        const prompt = prompts[field];
        if (!prompt) {
          await ctx.answerCallbackQuery("Unknown field.");
          return;
        }
        await setState(ctx.from.id, ADMIN_STATES.editProduct, {
          productId,
          field,
        });
        await ctx.answerCallbackQuery();
        await sendHtml(
          ctx,
          prompt + "\n\nSend /cancel to stop.",
          kb.cancelActionKeyboard(`adm:p:view:${productId}`)
        );
        return;
      }

      if (action === "delivery") {
        await ctx.answerCallbackQuery();
        await showDeliveryScreen(ctx, Number.parseInt(parts[3] ?? "0", 10));
        return;
      }

      if (action === "upload") {
        const productId = Number.parseInt(parts[3] ?? "0", 10);
        await setState(ctx.from.id, ADMIN_PRODUCT_FILE_STATE, { productId });
        await ctx.answerCallbackQuery();
        await sendHtml(
          ctx,
          "Send the <b>file</b> the buyer should receive (as a document, not a photo).\n\nSend /cancel to stop.",
          kb.cancelActionKeyboard(`adm:p:delivery:${productId}`)
        );
        return;
      }

      if (action === "text") {
        const productId = Number.parseInt(parts[3] ?? "0", 10);
        await setState(ctx.from.id, ADMIN_STATES.editProduct, {
          productId,
          field: "deliveryText",
        });
        await ctx.answerCallbackQuery();
        await sendHtml(
          ctx,
          "Send the <b>delivery text</b> — a download link, licence key, or instructions.\n\nSend /cancel to stop.",
          kb.cancelActionKeyboard(`adm:p:delivery:${productId}`)
        );
        return;
      }

      if (action === "types") {
        const productId = Number.parseInt(parts[3] ?? "0", 10);
        await ctx.answerCallbackQuery();
        await sendHtml(
          ctx,
          "What should the buyer receive for this product?",
          kb.deliveryTypeKeyboard(productId, "adm:p:settype")
        );
        return;
      }

      if (action === "settype") {
        const productId = Number.parseInt(parts[3] ?? "0", 10);
        const type = parts[4] ?? "";
        if (!["file", "text", "both"].includes(type)) {
          await ctx.answerCallbackQuery("Unknown delivery type.");
          return;
        }
        await updateProduct(productId, {
          deliveryType: type as "file" | "text" | "both",
        });
        await ctx.answerCallbackQuery("Delivery type updated");
        await showDeliveryScreen(ctx, productId);
        return;
      }

      if (action === "unfile") {
        const productId = Number.parseInt(parts[3] ?? "0", 10);
        await updateProduct(productId, { fileId: null, fileName: null });
        await ctx.answerCallbackQuery("File removed");
        await showDeliveryScreen(ctx, productId);
        return;
      }

      if (action === "toggle") {
        const productId = Number.parseInt(parts[3] ?? "0", 10);
        const product = await getProduct(productId);
        if (!product) {
          await ctx.answerCallbackQuery("Product not found.");
          return;
        }
        await updateProduct(productId, { active: product.active ? 0 : 1 });
        await ctx.answerCallbackQuery(
          product.active ? "Product disabled" : "Product enabled"
        );
        await showProductDetail(ctx, productId);
        return;
      }

      if (action === "delete") {
        const productId = Number.parseInt(parts[3] ?? "0", 10);
        const product = await getProduct(productId);
        if (!product) {
          await ctx.answerCallbackQuery("Product not found.");
          return;
        }
        await ctx.answerCallbackQuery();
        await render(
          ctx,
          `<b>Delete “${escapeHtml(product.name)}”?</b>\n\n` +
            `This removes it from the catalogue permanently. Existing orders keep their record.`,
          kb.confirmDeleteKeyboard(productId)
        );
        return;
      }

      if (action === "deleteok") {
        const productId = Number.parseInt(parts[3] ?? "0", 10);
        await deleteProduct(productId);
        await ctx.answerCallbackQuery("Product deleted");
        await showProductList(ctx, 0);
        return;
      }

      if (action === "addtype") {
        await handleAddType(ctx, parts[3] ?? "");
        return;
      }

      if (action === "addsave") {
        await handleAddSave(ctx, adminId);
        return;
      }

      await ctx.answerCallbackQuery("Unknown product action.");
      return;
    }

    /* ------------------------------ orders ------------------------------ */
    if (section === "o") {
      const rawScope = parts[3] ?? "all";

      if (action === "list") {
        const scope = rawScope === "pending" ? "pending" : "all";
        await ctx.answerCallbackQuery();
        await showOrderList(ctx, scope, Number.parseInt(parts[4] ?? "0", 10));
        return;
      }

      if (action === "view") {
        const orderId = Number.parseInt(parts[3] ?? "0", 10);
        const scope = parts[4] === "all" ? "all" : "pending";
        await ctx.answerCallbackQuery();
        await showOrderDetail(ctx, orderId, scope);
        return;
      }

      if (action === "approve") {
        // adm:o:approve:<orderId>:<scope>
        const orderId = Number.parseInt(parts[3] ?? "0", 10);
        const scope = parts[4] === "all" ? "all" : "pending";
        await approveOrder(ctx, orderId, scope, adminId);
        return;
      }

      if (action === "reject") {
        const orderId = Number.parseInt(parts[3] ?? "0", 10);
        const scope = parts[4] === "all" ? "all" : "pending";
        const order = await getOrder(orderId);
        if (!order) {
          await ctx.answerCallbackQuery("Order not found.");
          return;
        }
        await setState(ctx.from.id, ADMIN_STATES.orderReject, { orderId, scope });
        await ctx.answerCallbackQuery();
        await sendHtml(
          ctx,
          `<b>Rejecting ${escapeHtml(order.code)}</b>\n\n` +
            `Send the reason the buyer will see (for example “TrxID not found”). ` +
            `The buyer is notified and can submit a new transaction ID.\n\nSend /cancel to stop.`,
          kb.cancelActionKeyboard(`adm:o:view:${orderId}:${scope}`)
        );
        return;
      }

      await ctx.answerCallbackQuery("Unknown order action.");
      return;
    }

    /* ----------------------------- settings ----------------------------- */
    if (section === "s") {
      if (action === "edit") {
        const key = parts[3] ?? "";
        if (!isSettingKey(key)) {
          await ctx.answerCallbackQuery("Unknown setting.");
          return;
        }
        await setState(ctx.from.id, ADMIN_STATES.setting, { key });
        await ctx.answerCallbackQuery();
        await sendHtml(
          ctx,
          `<b>${escapeHtml(SETTING_LABELS[key])}</b>\n\n${SETTING_PROMPTS[key]}\n\nSend /cancel to stop.`,
          kb.cancelActionKeyboard("adm:s")
        );
        return;
      }

      await ctx.answerCallbackQuery();
      await showSettings(ctx);
      return;
    }

    /* ------------------------------ admins ------------------------------ */
    if (section === "a") {
      if (action === "add") {
        await setState(ctx.from.id, ADMIN_STATES.addAdmin, {});
        await ctx.answerCallbackQuery();
        await sendHtml(
          ctx,
          "Send the Telegram user ID of the new admin.\n\n" +
            "They can find their ID by sending /id to this bot.\n\nSend /cancel to stop.",
          kb.cancelActionKeyboard("adm:a:list")
        );
        return;
      }

      if (action === "del") {
        const target = Number.parseInt(parts[3] ?? "0", 10);
        const removed = await removeAdmin(target);
        await ctx.answerCallbackQuery(
          removed
            ? "Admin removed"
            : "That admin comes from ADMIN_IDS and cannot be removed here."
        );
        await showAdmins(ctx);
        return;
      }

      await ctx.answerCallbackQuery();
      await showAdmins(ctx);
      return;
    }

    await ctx.answerCallbackQuery("Unknown action.");
  });

}

/*
 * The add-product wizard's last two steps live in wizard.ts. They are injected
 * here at startup so this module does not have to import the wizard (which
 * imports this one for its screens), avoiding a circular dependency.
 */
type AddTypeHandler = (ctx: Context, type: string) => Promise<void>;
type AddSaveHandler = (ctx: Context, adminId: number) => Promise<void>;

let addTypeImpl: AddTypeHandler | undefined;
let addSaveImpl: AddSaveHandler | undefined;

export function bindWizardHandlers(handlers: {
  onAddType: AddTypeHandler;
  onAddSave: AddSaveHandler;
}): void {
  addTypeImpl = handlers.onAddType;
  addSaveImpl = handlers.onAddSave;
}

async function handleAddType(ctx: Context, type: string): Promise<void> {
  if (!addTypeImpl) {
    await ctx.answerCallbackQuery("Wizard is not ready yet, please try again.");
    return;
  }
  await addTypeImpl(ctx, type);
}

async function handleAddSave(ctx: Context, adminId: number): Promise<void> {
  if (!addSaveImpl) {
    await ctx.answerCallbackQuery("Wizard is not ready yet, please try again.");
    return;
  }
  await addSaveImpl(ctx, adminId);
}
