import type { Context } from "grammy";
import type { InlineKeyboard } from "grammy";

export const HTML_PARSE_MODE = "HTML" as const;

const DEFAULTS = {
  parse_mode: HTML_PARSE_MODE,
  link_preview_options: { is_disabled: true },
};

/**
 * Renders a screen.
 *
 * When the update came from an inline button the existing message is edited, so
 * navigating a list does not flood the chat with duplicates. For commands (and
 * when editing is impossible) a new message is sent instead.
 */
export async function render(
  ctx: Context,
  text: string,
  keyboard?: InlineKeyboard
): Promise<void> {
  if (ctx.callbackQuery) {
    try {
      await ctx.editMessageText(text, { ...DEFAULTS, reply_markup: keyboard });
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes("message is not modified")) return;
      console.error("[render] edit failed, sending a new message:", message);
    }
  }
  await ctx.reply(text, { ...DEFAULTS, reply_markup: keyboard });
}

/** Sends a plain HTML message without trying to edit anything. */
export async function sendHtml(
  ctx: Context,
  text: string,
  replyMarkup?: InlineKeyboard
): Promise<void> {
  await ctx.reply(text, { ...DEFAULTS, reply_markup: replyMarkup });
}
