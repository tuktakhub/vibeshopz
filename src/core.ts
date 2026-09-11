import { Bot, GrammyError, HttpError } from "grammy";
import { config } from "./config";

/**
 * The single Bot instance for the process.
 *
 * It lives in its own module so that handlers, notifiers and the delivery
 * service can all import it without creating a circular dependency.
 * Over HTTP (webhook) mode grammY never polls, so no `bot.start()` is needed —
 * `bot.init()` is called lazily by the webhook adapter.
 */
export const bot = new Bot(config.botToken);

export const api = bot.api;

bot.catch((err) => {
  const { ctx } = err;
  console.error(`[bot] failed to handle update ${ctx.update.update_id}`);

  if (err.error instanceof GrammyError) {
    console.error("[bot] Telegram API error:", err.error.description);
  } else if (err.error instanceof HttpError) {
    console.error("[bot] network error:", err.error.message);
  } else {
    console.error("[bot] unexpected error:", err.error);
  }
});
