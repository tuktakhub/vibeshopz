import { bot } from "./core";
import { getShopInfo } from "./settings";
import { getState } from "./state";
import * as kb from "./keyboards";
import * as t from "./texts";
import { registerCustomerHandlers } from "./handlers/customer";
import { registerAdminHandlers } from "./handlers/admin";
import { registerWizardHandlers } from "./handlers/wizard";

/**
 * Handler registration order matters:
 *
 *   1. customer  — commands (/start, /products, /orders, ...) and buyer buttons
 *   2. admin     — /admin and every `adm:` button
 *   3. wizard    — free-text / document answers for multi-step flows
 *   4. fallback  — anything unrecognised
 *
 * grammY stops at the first middleware that handles an update, so command
 * handlers registered first always win over the free-text wizard handler.
 */
registerCustomerHandlers(bot);
registerAdminHandlers(bot);
registerWizardHandlers(bot);

/* ------------------------------- fallbacks ------------------------------ */

bot.on("callback_query:data", async (ctx) => {
  await ctx.answerCallbackQuery({
    text: "That button is no longer available. Send /menu to start again.",
    show_alert: false,
  });
});

bot.on("message", async (ctx) => {
  if (!ctx.from) return;

  const state = await getState(ctx.from.id);
  if (state) {
    await ctx.reply(
      "I am waiting for your answer to the question above. Send /cancel to stop.",
      { parse_mode: "HTML" }
    );
    return;
  }

  const shop = await getShopInfo();
  await ctx.reply(t.mainMenuText(shop), {
    parse_mode: "HTML",
    reply_markup: kb.mainMenu(),
    link_preview_options: { is_disabled: true },
  });
});

export { bot };
