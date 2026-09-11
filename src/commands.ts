import type { Api } from "grammy";
import { config } from "./config";

/**
 * The command list Telegram shows when a user types "/".
 *
 * Kept in one place so the local runner, the deploy script and the bot itself
 * always publish the same list.
 */
export interface CommandSpec {
  command: string;
  description: string;
}

export const BOT_COMMANDS: CommandSpec[] = [
  { command: "start", description: "Open main menu" },
  { command: "shop", description: "Browse products" },
  { command: "orders", description: "My orders" },
  { command: "wallet", description: "My wallet" },
  { command: "profile", description: "My profile" },
  { command: "refer", description: "Refer & earn" },
  { command: "support", description: "Contact support" },
  { command: "help", description: "How it works" },
];

/** Buyers never see /admin; it is published only into an admin's own chat. */
export const ADMIN_COMMANDS: CommandSpec[] = [
  ...BOT_COMMANDS,
  { command: "admin", description: "Admin panel" },
];

/**
 * Publishes the command list to Telegram.
 *
 * The default scope replaces whatever was there before, so a stale command list
 * cannot survive a deploy. Admins listed in ADMIN_IDS additionally get an
 * admin-scoped list containing /admin — admins added later from
 * /admin -> Admins are not covered here, they can still type /admin.
 */
export async function applyBotCommands(api: Api): Promise<void> {
  await api.setMyCommands(BOT_COMMANDS);

  for (const adminId of config.adminIds) {
    try {
      await api.setMyCommands(ADMIN_COMMANDS, {
        scope: { type: "chat", chat_id: adminId },
      });
    } catch (error) {
      console.error(`[commands] could not set the admin command list for ${adminId}:`, error);
    }
  }
}
