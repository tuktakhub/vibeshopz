import { all, one, run } from "./db";
import { config, normalizeHandle } from "./config";

/** Runtime-editable key/value settings, with env vars as the fallback. */
export async function getSetting(key: string): Promise<string | null> {
  const row = await one<{ value: string }>(
    "SELECT value FROM settings WHERE key = ?",
    [key]
  );
  const value = row?.value ?? null;
  return value !== null && value.trim() !== "" ? value : null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value]
  );
}

export async function getAllSettings(): Promise<Record<string, string>> {
  const rows = await all<{ key: string; value: string }>(
    "SELECT key, value FROM settings"
  );
  const out: Record<string, string> = {};
  for (const row of rows) out[row.key] = row.value;
  return out;
}

export interface ShopInfo {
  shopName: string;
  supportUsername: string;
  paymentMethodName: string;
  paymentNumber: string;
  paymentInstructions: string;
  paymentNote: string;
}

/**
 * Resolves the shop-wide values shown to buyers. Database values always win
 * over environment variables so an admin can change them without a redeploy.
 */
export async function getShopInfo(): Promise<ShopInfo> {
  const stored = await getAllSettings();
  const pick = (key: string, fallback: string): string => {
    const value = stored[key];
    return value && value.trim() ? value : fallback;
  };

  return {
    shopName: pick("shop_name", config.shopName),
    supportUsername: pick(
      "support_username",
      normalizeHandle(config.supportUsername)
    ),
    paymentMethodName: pick(
      "payment_method_name",
      config.paymentDefaults.methodName
    ),
    paymentNumber: pick("payment_number", config.paymentDefaults.number),
    paymentInstructions: pick(
      "payment_instructions",
      config.paymentDefaults.instructions
    ),
    paymentNote: pick("payment_note", config.paymentDefaults.note),
  };
}
