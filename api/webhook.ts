import { webhookCallback } from "grammy";
import { bot } from "../src/bot";
import { config } from "../src/config";
import { ensureSchema } from "../src/db";
import { headerValue, type ApiRequest, type ApiResponse } from "./_http";

/**
 * Telegram webhook endpoint.
 *
 * Point Telegram at  https://<your-deployment>.vercel.app/api/webhook
 * (see `npm run webhook:set`).
 */
export const maxDuration = 30;

const handleUpdate = webhookCallback(bot, "std/http");

/** Connects the database and reads the bot identity, at most once per instance. */
let bootstrapPromise: Promise<void> | undefined;

function bootstrap(): Promise<void> {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      await ensureSchema();
      if (!bot.isInited()) await bot.init();
    })().catch((error) => {
      bootstrapPromise = undefined;
      throw error;
    });
  }
  return bootstrapPromise;
}

export default async function handler(
  req: ApiRequest,
  res: ApiResponse
): Promise<void> {
  if (req.method === "GET" || req.method === "HEAD") {
    res.status(200).json({
      ok: true,
      service: "telegram-digital-store-bot",
      endpoint: "/api/webhook",
    });
    return;
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  // Telegram echoes WEBHOOK_SECRET back in this header when it is configured.
  if (config.webhookSecret) {
    const provided = headerValue(
      req.headers,
      "x-telegram-bot-api-secret-token"
    );
    if (provided !== config.webhookSecret) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }
  }

  // Vercel parses JSON bodies automatically, but fall back to raw parsing.
  let update: unknown = req.body;
  if (typeof update === "string") {
    try {
      update = JSON.parse(update);
    } catch {
      update = undefined;
    }
  }

  if (
    !update ||
    typeof update !== "object" ||
    !("update_id" in (update as Record<string, unknown>))
  ) {
    res.status(200).json({ ok: true, skipped: "not a Telegram update" });
    return;
  }

  try {
    await bootstrap();
  } catch (error) {
    console.error("[webhook] bootstrap failed:", error);
    res.status(500).json({ ok: false, error: "Bootstrap failed" });
    return;
  }

  try {
    const request = new Request(
      `https://${headerValue(req.headers, "host") ?? "localhost"}/api/webhook`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(update),
      }
    );

    const response = await handleUpdate(request);
    res.status(response.status).send(await response.text());
  } catch (error) {
    console.error("[webhook] could not process the update:", error);
    // A non-2xx response makes Telegram retry the update later.
    res.status(500).json({ ok: false, error: "Update processing failed" });
  }
}
