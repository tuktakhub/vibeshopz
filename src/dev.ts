/**
 * Local development entry point.
 *
 * Runs the same bot over long polling so you can test without a public URL.
 * Importing `./bot` registers every handler.
 */
import { bot } from "./core";
import { ensureSchema } from "./db";
import "./bot";

async function main(): Promise<void> {
  await ensureSchema();

  // A webhook and long polling cannot both be active for the same token.
  await bot.api.deleteWebhook({ drop_pending_updates: false });

  console.log("Starting in long-polling mode. Press Ctrl+C to stop.");
  await bot.start({
    onStart: (info) => console.log(`Listening as @${info.username}`),
  });
}

main().catch((error) => {
  console.error("Failed to start the bot:", error);
  process.exit(1);
});
