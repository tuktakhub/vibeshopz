import { all, one, run } from "./db";
import { config } from "./config";

const cache = new Map<number, { allowed: boolean; at: number }>();
const CACHE_TTL_MS = 30_000;

/**
 * Admins come from two places:
 *   1. ADMIN_IDS in the environment — always admins, cannot be revoked at runtime
 *   2. the `admins` table — managed from /admin -> Admins
 */
export async function isAdmin(userId: number): Promise<boolean> {
  if (config.adminIds.includes(userId)) return true;

  const cached = cache.get(userId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.allowed;

  const row = await one<{ user_id: number }>(
    "SELECT user_id FROM admins WHERE user_id = ?",
    [userId]
  );
  const allowed = Boolean(row);
  cache.set(userId, { allowed, at: Date.now() });
  return allowed;
}

export async function listAdmins(): Promise<number[]> {
  const rows = await all<{ user_id: number }>(
    "SELECT user_id FROM admins ORDER BY added_at ASC"
  );
  const merged = new Set<number>([...config.adminIds, ...rows.map((r) => r.user_id)]);
  return [...merged];
}

export async function addAdmin(userId: number, addedBy: number): Promise<void> {
  cache.delete(userId);
  await run(
    `INSERT INTO admins (user_id, added_by) VALUES (?, ?)
     ON CONFLICT(user_id) DO NOTHING`,
    [userId, addedBy]
  );
}

export async function removeAdmin(userId: number): Promise<boolean> {
  if (config.adminIds.includes(userId)) return false;
  cache.delete(userId);
  await run("DELETE FROM admins WHERE user_id = ?", [userId]);
  return true;
}
