/**
 * Registers (or removes) the Telegram webhook for this deployment.
 *
 *   npm run webhook:set                          # uses PUBLIC_URL from .env
 *   npm run webhook:set -- https://app.vercel.app
 *   npm run webhook:info
 *   npm run webhook:delete
 */
import { bot } from "../src/core";
import { config } from "../src/config";

const ALLOWED_UPDATES = ["message", "callback_query"] as const;

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--info")) {
    const info = await bot.api.getWebhookInfo();
    console.log(JSON.stringify(info, null, 2));
    return;
  }

  if (args.includes("--delete")) {
    await bot.api.deleteWebhook({ drop_pending_updates: true });
    console.log("Webhook removed. The bot will not receive updates until one is set.");
    return;
  }

  const fromArgs = args.find((arg) => arg.startsWith("http"));
  const base = (fromArgs ?? config.publicUrl).replace(/\/+$/, "");

  if (!base) {
    throw new Error(
      "No deployment URL. Pass it as an argument or set PUBLIC_URL in .env, " +
        "for example: npm run webhook:set -- https://my-bot.vercel.app"
    );
  }

  const url = `${base}/api/webhook`;

  await bot.api.setWebhook(url, {
    allowed_updates: [...ALLOWED_UPDATES],
    drop_pending_updates: true,
    ...(config.webhookSecret ? { secret_token: config.webhookSecret } : {}),
  });

  console.log(`Webhook registered: ${url}`);
  if (!config.webhookSecret) {
    console.warn(
      "Warning: WEBHOOK_SECRET is empty, so anyone who knows the URL can post " +
        "fake updates. Set it in .env and in Vercel, then run this again."
    );
  }

  const info = await bot.api.getWebhookInfo();
  console.log(JSON.stringify(info, null, 2));
}

main().catch((error) => {
  console.error("set-webhook failed:", error);
  process.exit(1);
});
