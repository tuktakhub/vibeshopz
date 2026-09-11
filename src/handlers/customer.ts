import { InlineKeyboard, type Bot, type Context } from "grammy";
import { config } from "../config";
import { getShopInfo } from "../settings";
import {
  countProducts,
  countUserOrders,
  createOrder,
  getOrder,
  getProduct,
  listProducts,
  listUserOrders,
  markOrderCancelled,
  upsertUser,
} from "../repository";
import { clearState, setState, USER_STATES } from "../state";
import { isAdmin } from "../admins";
import * as kb from "../keyboards";
import * as t from "../texts";
import { clampPage, pageCount } from "../utils";
import { HTML_PARSE_MODE, render } from "./render";

const HTML = {
  parse_mode: HTML_PARSE_MODE,
  link_preview_options: { is_disabled: true },
};

async function showCatalogue(
  ctx: Context,
  page: number,
  edit: boolean
): Promise<void> {
  const shop = await getShopInfo();
  const perPage = config.productsPerPage;
  const total = await countProducts(true);

  if (total === 0) {
    const text = t.emptyCatalogue(shop);
    const keyboard = new InlineKeyboard().text("Main menu", "m:home");
    if (edit) await render(ctx, text, keyboard);
    else await ctx.reply(text, { ...HTML, reply_markup: kb.mainMenu() });
    return;
  }

  const totalPages = pageCount(total, perPage);
  const current = clampPage(page, totalPages);
  const products = await listProducts({
    activeOnly: true,
    limit: perPage,
    offset: current * perPage,
  });

  const text = t.catalogueHeader(shop, total);
  const keyboard = kb.catalogueKeyboard(products, current, totalPages);
  if (edit) await render(ctx, text, keyboard);
  else await ctx.reply(text, { ...HTML, reply_markup: keyboard });
}

async function showProduct(
  ctx: Context,
  productId: number,
  edit: boolean
): Promise<void> {
  const product = await getProduct(productId);
  if (!product || !product.active) {
    const text = "That product is no longer available.";
    if (edit) await render(ctx, text, new InlineKeyboard().text("« Back to catalogue", "cat:p:0"));
    else await ctx.reply(text, { ...HTML, reply_markup: kb.mainMenu() });
    return;
  }
  const text = t.productDetail(product);
  const keyboard = kb.productDetailKeyboard(product.id);
  if (edit) await render(ctx, text, keyboard);
  else await ctx.reply(text, { ...HTML, reply_markup: keyboard });
}

async function showOrders(
  ctx: Context,
  page: number,
  edit: boolean
): Promise<void> {
  const userId = ctx.from!.id;
  const perPage = config.ordersPerPage;
  const total = await countUserOrders(userId);
  const text = t.ordersHeader(total);

  if (total === 0) {
    const keyboard = new InlineKeyboard().text("Browse products", "cat:p:0");
    if (edit) await render(ctx, text, keyboard);
    else await ctx.reply(text, { ...HTML, reply_markup: kb.mainMenu() });
    return;
  }

  const totalPages = pageCount(total, perPage);
  const current = clampPage(page, totalPages);
  const orders = await listUserOrders(userId, perPage, current * perPage);
  const keyboard = kb.myOrdersKeyboard(orders, current, totalPages);
  if (edit) await render(ctx, text, keyboard);
  else await ctx.reply(text, { ...HTML, reply_markup: keyboard });
}

export function registerCustomerHandlers(bot: Bot): void {
  /* --------------------------- tracking users --------------------------- */

  bot.use(async (ctx, next) => {
    const from = ctx.from;
    if (from && !from.is_bot) {
      try {
        await upsertUser({
          id: from.id,
          firstName: from.first_name,
          lastName: from.last_name,
          username: from.username,
        });
      } catch (error) {
        // Never block the update because analytics bookkeeping failed.
        console.error("[users] could not record the user:", error);
      }
    }
    await next();
  });

  /* ------------------------------ commands ------------------------------ */

  bot.command(["start", "menu"], async (ctx) => {
    await clearState(ctx.from!.id);
    const shop = await getShopInfo();
    await ctx.reply(t.welcome(shop), { ...HTML, reply_markup: kb.mainMenu() });
  });

  bot.command("help", async (ctx) => {
    const shop = await getShopInfo();
    await ctx.reply(t.helpText(shop), { ...HTML, reply_markup: kb.mainMenu() });
  });

  bot.command("products", async (ctx) => {
    await showCatalogue(ctx, 0, false);
  });

  bot.command("orders", async (ctx) => {
    await showOrders(ctx, 0, false);
  });

  bot.command("support", async (ctx) => {
    const shop = await getShopInfo();
    await ctx.reply(t.supportText(shop), { ...HTML, reply_markup: kb.mainMenu() });
  });

  bot.command("cancel", async (ctx) => {
    await clearState(ctx.from!.id);
    await ctx.reply(t.cancelledWizard(), { ...HTML, reply_markup: kb.mainMenu() });
  });

  bot.command("id", async (ctx) => {
    const from = ctx.from!;
    const admin = await isAdmin(from.id);
    await ctx.reply(
      `Your Telegram ID is <code>${from.id}</code>.\n\n` +
        (admin
          ? "You are an admin of this bot — open /admin."
          : "Send this ID to the shop owner if you need admin access."),
      { parse_mode: "HTML" }
    );
  });

  /* ---------------------------- menu buttons ---------------------------- */

  bot.callbackQuery(/^m:(home|help|support|noop|cancel)$/, async (ctx) => {
    const action = ctx.callbackQuery.data.split(":")[1];

    if (action === "noop") {
      await ctx.answerCallbackQuery();
      return;
    }

    if (action === "cancel") {
      await clearState(ctx.from.id);
      await ctx.answerCallbackQuery("Cancelled");
      await ctx.reply(t.cancelledWizard());
      return;
    }

    await ctx.answerCallbackQuery();
    const shop = await getShopInfo();
    if (action === "home") {
      await render(ctx, t.mainMenuText(shop), kb.mainMenu());
    } else if (action === "help") {
      await render(ctx, t.helpText(shop), kb.mainMenu());
    } else {
      await render(ctx, t.supportText(shop), kb.mainMenu());
    }
  });

  /* ------------------------------ catalogue ----------------------------- */

  bot.callbackQuery(/^cat:(p|v):/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const [, what, value] = ctx.callbackQuery.data.split(":");
    const id = Number.parseInt(value ?? "0", 10);
    if (what === "p") await showCatalogue(ctx, Number.isFinite(id) ? id : 0, true);
    else await showProduct(ctx, id, true);
  });

  /* -------------------------------- orders ------------------------------ */

  bot.callbackQuery(/^ord:/, async (ctx) => {
    const [, action, rawId] = ctx.callbackQuery.data.split(":");
    const orderId = Number.parseInt(rawId ?? "0", 10);

    if (action === "new") {
      const product = await getProduct(orderId);
      if (!product || !product.active) {
        await ctx.answerCallbackQuery("This product is no longer available.");
        return;
      }
      if (product.stock !== null && product.stock <= 0) {
        await ctx.answerCallbackQuery("This product is sold out.");
        return;
      }

      const order = await createOrder({
        userId: ctx.from.id,
        username: ctx.from.username ?? null,
        firstName: ctx.from.first_name ?? null,
        product,
      });
      const shop = await getShopInfo();

      await ctx.answerCallbackQuery("Order created");
      await ctx.reply(t.orderCreated(order, shop), {
        ...HTML,
        reply_markup: kb.orderPaymentKeyboard(order.id),
      });
      return;
    }

    if (action === "p") {
      await ctx.answerCallbackQuery();
      await showOrders(ctx, Number.isFinite(orderId) ? orderId : 0, true);
      return;
    }

    const order = await getOrder(orderId);
    if (!order || order.user_id !== ctx.from.id) {
      await ctx.answerCallbackQuery("Order not found.");
      return;
    }

    if (action === "v") {
      await ctx.answerCallbackQuery();
      await render(ctx, t.orderDetails(order), kb.orderDetailKeyboard(order));
      return;
    }

    if (action === "txn") {
      if (order.status === "delivered") {
        await ctx.answerCallbackQuery("This order was already delivered.");
        return;
      }
      if (order.status === "cancelled") {
        await ctx.answerCallbackQuery("This order was cancelled. Please order again.");
        return;
      }
      await setState(ctx.from.id, USER_STATES.submitTxn, { orderId: order.id });
      await ctx.answerCallbackQuery();
      await ctx.reply(t.askTxnId(order), {
        ...HTML,
        reply_markup: kb.cancelWizardKeyboard(),
      });
      return;
    }

    if (action === "cancel") {
      if (order.status === "delivered") {
        await ctx.answerCallbackQuery("That order was already delivered and cannot be cancelled.");
        return;
      }
      if (order.status === "cancelled") {
        await ctx.answerCallbackQuery("That order is already cancelled.");
        return;
      }
      await markOrderCancelled(order.id);
      await clearState(ctx.from.id);
      await ctx.answerCallbackQuery("Order cancelled");
      await ctx.reply(t.orderCancelled(order), { ...HTML, reply_markup: kb.mainMenu() });
      return;
    }

    await ctx.answerCallbackQuery();
  });
}
