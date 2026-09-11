import { InlineKeyboard, type Bot, type Context } from "grammy";
import { config } from "../config";
import { bot as botInstance } from "../core";
import { deliverOrder } from "../delivery";
import { payReferralReward } from "../rewards";
import { getShopInfo } from "../settings";
import {
  attachReferrer,
  countProducts,
  countReferrals,
  countUserDeposits,
  countUserOrders,
  createDeposit,
  createOrder,
  debitBalance,
  ensureReferralCode,
  findUserByReferralCode,
  getDeposit,
  getOrder,
  getProduct,
  getUser,
  listProducts,
  listUserDeposits,
  listUserOrders,
  markDepositCancelled,
  markOrderCancelled,
  sumUserSpent,
  upsertUser,
} from "../repository";
import { notifyAdmins } from "../notify";
import { clearState, setState, USER_STATES } from "../state";
import { isAdmin } from "../admins";
import * as kb from "../keyboards";
import * as t from "../texts";
import { clampPage, formatMoney, pageCount } from "../utils";
import type { ShopUser } from "../types";
import { HTML_PARSE_MODE, render } from "./render";

const HTML = {
  parse_mode: HTML_PARSE_MODE,
  link_preview_options: { is_disabled: true },
};

/* ---------------------------- main screens ------------------------------ */

async function loadUser(userId: number): Promise<ShopUser> {
  const existing = await getUser(userId);
  if (existing) return existing;

  // The tracking middleware normally guarantees this row exists; recreate it
  // defensively rather than crashing a whole screen.
  await upsertUser({ id: userId, firstName: "User" });
  const created = await getUser(userId);
  if (!created) throw new Error(`Could not load user ${userId}`);
  return created;
}

/**
 * Renders a screen that carries the welcome grid.
 *
 * A Telegram message can hold only one keyboard, so the grid sits on the
 * welcome / help / support screens and every other screen routes back to it.
 */
async function showGridScreen(ctx: Context, text: string): Promise<void> {
  await render(ctx, text, kb.welcomeMenu());
}

async function showHome(ctx: Context): Promise<void> {
  const shop = await getShopInfo();
  await showGridScreen(ctx, t.homeScreen(shop));
}

async function showHelp(ctx: Context): Promise<void> {
  const shop = await getShopInfo();
  await showGridScreen(ctx, t.helpText(shop));
}

async function showSupport(ctx: Context): Promise<void> {
  const shop = await getShopInfo();
  await showGridScreen(ctx, t.supportText(shop));
}

async function showWallet(ctx: Context): Promise<void> {
  const userId = ctx.from!.id;
  const [user, deposits] = await Promise.all([
    loadUser(userId),
    countUserDeposits(userId),
  ]);
  await render(ctx, t.walletScreen(user, deposits), kb.walletKeyboard(deposits > 0));
}

async function showProfile(ctx: Context): Promise<void> {
  const userId = ctx.from!.id;
  const [user, orders, spent, referrals] = await Promise.all([
    loadUser(userId),
    countUserOrders(userId),
    sumUserSpent(userId),
    countReferrals(userId),
  ]);

  await render(
    ctx,
    t.profileScreen(user, { orders, spent, referrals }),
    kb.profileKeyboard()
  );
}

/** Builds the personal invite link plus a ready-to-forward share link. */
function inviteLinks(code: string): { link: string; share: string } {
  const username = botInstance.botInfo?.username ?? "";
  const link = `https://t.me/${username}?start=ref_${code}`;
  const text = "Join this shop — here is my invite link:";
  const share = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
  return { link, share };
}

async function showReferral(ctx: Context): Promise<void> {
  const userId = ctx.from!.id;
  const [user, referrals, shop] = await Promise.all([
    loadUser(userId),
    countReferrals(userId),
    getShopInfo(),
  ]);

  const code = await ensureReferralCode(userId);
  const { link, share } = inviteLinks(code);

  await render(
    ctx,
    t.referralScreen({
      link,
      referrals,
      reward: shop.referralReward,
      balance: Number(user.balance ?? 0),
    }),
    kb.referralKeyboard(share)
  );
}

async function showDepositAmounts(ctx: Context): Promise<void> {
  const shop = await getShopInfo();
  await render(
    ctx,
    t.depositAmountPrompt(shop),
    kb.depositAmountKeyboard(shop.minDeposit)
  );
}

/**
 * Creates a deposit for a chosen amount and shows the manual payment details.
 * Used both by the preset buttons and by the “Other amount” free-text step.
 */
export async function startDeposit(ctx: Context, amount: number): Promise<void> {
  const shop = await getShopInfo();
  const userId = ctx.from!.id;

  if (!Number.isFinite(amount) || amount < shop.minDeposit) {
    await ctx.reply(
      `The minimum top-up is ${formatMoney(shop.minDeposit)}. Please enter a larger amount, or /cancel.`
    );
    return;
  }

  const deposit = await createDeposit({
    userId,
    amount,
    currency: config.currencySymbol,
  });

  await clearState(userId);
  await ctx.reply(t.depositCreated(deposit, shop), {
    ...HTML,
    reply_markup: kb.depositPaymentKeyboard(deposit.id),
  });
}

async function showDepositHistory(ctx: Context, page: number): Promise<void> {
  const userId = ctx.from!.id;
  const perPage = config.ordersPerPage;
  const deposits = await listUserDeposits(userId, 200);
  const total = deposits.length;

  if (total === 0) {
    await render(ctx, t.depositHistoryHeader(0), kb.walletKeyboard(false));
    return;
  }

  const totalPages = pageCount(total, perPage);
  const current = clampPage(page, totalPages);
  const slice = deposits.slice(current * perPage, current * perPage + perPage);

  await render(
    ctx,
    t.depositHistoryHeader(total),
    kb.depositsKeyboard(slice, current, totalPages)
  );
}

/**
 * Reads the `ref_XXXXXX` payload Telegram attaches to an invite deep link.
 * Attribution is silent — the invitee never has to confirm anything.
 */
async function captureReferral(ctx: Context): Promise<void> {
  const payload = ctx.match;
  if (typeof payload !== "string" || !payload.trim()) return;

  const code = payload.trim().replace(/^ref[_-]?/i, "");
  if (!code) return;

  const referrer = await findUserByReferralCode(code);
  if (referrer) await attachReferrer(ctx.from!.id, referrer.user_id);
}

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

  bot.command("start", async (ctx) => {
    await clearState(ctx.from!.id);
    await captureReferral(ctx);
    await showHome(ctx);
  });

  bot.command("menu", async (ctx) => {
    await clearState(ctx.from!.id);
    await showHome(ctx);
  });

  bot.command("help", async (ctx) => {
    await showHelp(ctx);
  });

  bot.command(["products", "shop"], async (ctx) => {
    await showCatalogue(ctx, 0, false);
  });

  bot.command("orders", async (ctx) => {
    await showOrders(ctx, 0, false);
  });

  bot.command("wallet", async (ctx) => {
    await showWallet(ctx);
  });

  bot.command("profile", async (ctx) => {
    await showProfile(ctx);
  });

  bot.command(["refer", "invite"], async (ctx) => {
    await showReferral(ctx);
  });

  bot.command("support", async (ctx) => {
    await showSupport(ctx);
  });

  bot.command("cancel", async (ctx) => {
    await clearState(ctx.from!.id);
    await ctx.reply(t.cancelledWizard(), { ...HTML, reply_markup: kb.welcomeMenu() });
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
    if (action === "home") {
      await showHome(ctx);
    } else if (action === "help") {
      await showHelp(ctx);
    } else {
      await showSupport(ctx);
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

      const userId = ctx.from.id;

      // Wallet first: money already in the wallet is spent instantly, so the
      // buyer never waits for an admin. The balance check lives inside
      // debitBalance, in the database, so two fast taps cannot double-spend.
      const user = await loadUser(userId);
      if (product.price > 0 && Number(user.balance ?? 0) >= product.price) {
        const debited = await debitBalance(userId, product.price);

        if (debited) {
          const paidOrder = await createOrder({
            userId,
            username: ctx.from.username ?? null,
            firstName: ctx.from.first_name ?? null,
            product,
            paidFromBalance: true,
          });

          await ctx.answerCallbackQuery("Paid from your wallet");
          const delivery = await deliverOrder(paidOrder);

          if (!delivery.ok) {
            await ctx.reply(
              `Your wallet was charged for ${paidOrder.code}, but automatic delivery ` +
                `failed: ${delivery.error ?? "unknown error"}\n\n` +
                `An admin has been notified and will deliver it manually.`,
              HTML
            );
            await notifyAdmins(
              `<b>Delivery failed after a wallet payment</b>\n\n` +
                `Order ${paidOrder.code} was paid from the wallet but could not be delivered.\n` +
                `${delivery.error ?? ""}`
            );
          }

          // First purchase unlocks the referrer's reward. Safe to call every time.
          await payReferralReward(userId);
          return;
        }
      }

      const order = await createOrder({
        userId,
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

  /* ------------------------------- wallet ------------------------------- */

  bot.callbackQuery(/^wal:/, async (ctx) => {
    const [, action, rawValue] = ctx.callbackQuery.data.split(":");
    const userId = ctx.from.id;
    const value = rawValue ?? "";

    if (action === "p") {
      await ctx.answerCallbackQuery();
      await showWallet(ctx);
      return;
    }

    if (action === "add") {
      await ctx.answerCallbackQuery();
      await showDepositAmounts(ctx);
      return;
    }

    if (action === "amt") {
      if (value === "custom") {
        const shop = await getShopInfo();
        await setState(userId, USER_STATES.depositAmount, {});
        await ctx.answerCallbackQuery();
        await ctx.reply(t.askCustomDepositAmount(shop), {
          ...HTML,
          reply_markup: kb.cancelWizardKeyboard(),
        });
        return;
      }

      await ctx.answerCallbackQuery();
      await startDeposit(ctx, Number.parseFloat(value));
      return;
    }

    // Paging is handled before any lookup: the page number is not a deposit id.
    if (action === "hist") {
      await ctx.answerCallbackQuery();
      await showDepositHistory(ctx, Number.parseInt(value, 10) || 0);
      return;
    }

    const deposit = await getDeposit(Number.parseInt(value, 10));
    if (!deposit || deposit.user_id !== userId) {
      await ctx.answerCallbackQuery("Deposit not found.");
      return;
    }

    if (action === "v") {
      await ctx.answerCallbackQuery();
      await render(
        ctx,
        t.depositDetail(deposit),
        new InlineKeyboard().text("« Deposit history", "wal:hist:0")
      );
      return;
    }

    if (action === "txn") {
      if (deposit.status === "approved") {
        await ctx.answerCallbackQuery("This deposit was already credited.");
        return;
      }
      if (deposit.status === "cancelled" || deposit.status === "rejected") {
        await ctx.answerCallbackQuery("This deposit is closed — please start a new one.");
        return;
      }

      await setState(userId, USER_STATES.depositTxn, { depositId: deposit.id });
      await ctx.answerCallbackQuery();
      await ctx.reply(t.askDepositTxnId(deposit), {
        ...HTML,
        reply_markup: kb.cancelWizardKeyboard(),
      });
      return;
    }

    if (action === "cancel") {
      await markDepositCancelled(deposit.id);
      await clearState(userId);
      await ctx.answerCallbackQuery("Deposit cancelled");
      await ctx.reply(t.depositCancelled(deposit), {
        ...HTML,
        reply_markup: kb.walletKeyboard(true),
      });
      return;
    }

    await ctx.answerCallbackQuery();
  });

  /* ---------------------- profile and referrals ------------------------- */

  bot.callbackQuery("prf", async (ctx) => {
    await ctx.answerCallbackQuery();
    await showProfile(ctx);
  });

  bot.callbackQuery("ref", async (ctx) => {
    await ctx.answerCallbackQuery();
    await showReferral(ctx);
  });
}
