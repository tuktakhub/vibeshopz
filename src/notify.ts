import type { InlineKeyboard, Keyboard } from "grammy";
import { api } from "./core";
import { listAdmins } from "./admins";

/** Sends an HTML message and swallows per-chat failures so one bad admin cannot break the flow. */
export async function safeSend(
  chatId: number,
  text: string,
  options: {
    parse_mode?: "HTML";
    reply_markup?: InlineKeyboard | Keyboard;
    link_preview_options?: { is_disabled?: boolean };
  } = {}
): Promise<boolean> {
  try {
    await api.sendMessage(chatId, text, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...options,
    });
    return true;
  } catch (error) {
    console.error(`[notify] could not message chat ${chatId}:`, error);
    return false;
  }
}

export async function notifyAdmins(
  text: string,
  keyboard?: InlineKeyboard
): Promise<void> {
  const admins = await listAdmins();
  await Promise.all(
    admins.map((adminId) => safeSend(adminId, text, { reply_markup: keyboard }))
  );
}
