import { api } from "./core";
import {
  decrementStock,
  getProduct,
  markOrderDelivered,
} from "./repository";
import { escapeHtml, formatMoney } from "./utils";
import { config } from "./config";
import type { Order } from "./types";

export interface DeliveryResult {
  ok: boolean;
  error?: string;
}

/**
 * Sends the purchased product to the buyer and marks the order as delivered.
 *
 * A product can deliver a Telegram file, a text block (download link, licence
 * key, ...) or both — controlled by `product.delivery_type`.
 */
export async function deliverOrder(order: Order): Promise<DeliveryResult> {
  const product = await getProduct(order.product_id);
  if (!product) {
    return {
      ok: false,
      error: "The product was deleted from the catalogue, so nothing could be delivered.",
    };
  }

  const wantsFile =
    product.delivery_type === "file" || product.delivery_type === "both";
  const wantsText =
    product.delivery_type === "text" || product.delivery_type === "both";

  const header =
    `<b>Order ${escapeHtml(order.code)} approved</b>\n\n` +
    `Product: <b>${escapeHtml(product.name)}</b>\n` +
    `Amount: <b>${formatMoney(order.price)}</b>\n\n` +
    `Thank you for your purchase. Your product is below.`;

  try {
    await api.sendMessage(order.user_id, header, { parse_mode: "HTML" });
  } catch (error) {
    console.error("[delivery] header message failed:", error);
    return {
      ok: false,
      error:
        "Could not message the buyer. They may have blocked the bot or deleted their account.",
    };
  }

  const problems: string[] = [];
  let sentSomething = false;

  if (wantsFile) {
    if (!product.file_id) {
      problems.push("No file is attached to this product.");
    } else {
      try {
        await api.sendDocument(order.user_id, product.file_id, {
          caption: `<b>${escapeHtml(product.name)}</b>`,
          parse_mode: "HTML",
        });
        sentSomething = true;
      } catch (error) {
        console.error("[delivery] sendDocument failed:", error);
        problems.push(
          "Telegram rejected the stored file id — re-upload the file on this product."
        );
      }
    }
  }

  if (wantsText) {
    if (!product.delivery_text) {
      problems.push("No delivery text is set for this product.");
    } else {
      try {
        // Sent without a parse mode so links and keys are never mangled.
        await api.sendMessage(order.user_id, product.delivery_text, {
          link_preview_options: { is_disabled: false },
        });
        sentSomething = true;
      } catch (error) {
        console.error("[delivery] delivery text failed:", error);
        problems.push("The delivery text could not be sent.");
      }
    }
  }

  if (!wantsFile && !wantsText) {
    problems.push("This product has no delivery content configured.");
  }

  if (!sentSomething) {
    return {
      ok: false,
      error: problems.join(" ") || "Nothing could be delivered.",
    };
  }

  await markOrderDelivered(order.id);
  await decrementStock(order.product_id);

  return {
    ok: true,
    error: problems.length
      ? `Delivered with warnings: ${problems.join(" ")}`
      : undefined,
  };
}

/** Builds the delivery preview an admin sees on the product screen. */
export function describeDelivery(product: {
  delivery_type: string;
  file_id: string | null;
  file_name: string | null;
  delivery_text: string | null;
}): string {
  const parts: string[] = [];
  if (product.file_id) {
    parts.push(`file: <code>${escapeHtml(product.file_name ?? "attached")}</code>`);
  }
  if (product.delivery_text) {
    const preview = product.delivery_text.replace(/\s+/g, " ").slice(0, 60);
    parts.push(`text: <code>${escapeHtml(preview)}</code>`);
  }
  return parts.length ? parts.join("\n") : "empty";
}

export const maxCaptionLength = 1024;
export const currencySymbol = config.currencySymbol;
