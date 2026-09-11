import { one } from "../src/db";
import { ensureSchema } from "../src/db";
import type { ApiRequest, ApiResponse } from "./_http";

/**
 * Deployment smoke test: verifies that the Turso credentials work and the
 * schema exists, and reports the runtime the serverless function actually uses
 * (so a pinned Node version can be confirmed rather than assumed).
 * Open it in a browser after deploying.
 */
export default async function handler(
  _req: ApiRequest,
  res: ApiResponse
): Promise<void> {
  try {
    await ensureSchema();
    const products = await one<{ total: number }>(
      "SELECT COUNT(*) AS total FROM products"
    );
    const orders = await one<{ total: number }>(
      "SELECT COUNT(*) AS total FROM orders"
    );

    res.status(200).json({
      ok: true,
      database: "connected",
      products: Number(products?.total ?? 0),
      orders: Number(orders?.total ?? 0),
      node: process.version,
      time: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      database: "unavailable",
      node: process.version,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
