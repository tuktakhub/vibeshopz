import { safeSend } from "./notify";
import {
  claimReferralReward,
  creditBalance,
  getUser,
} from "./repository";
import { getShopInfo } from "./settings";
import { escapeHtml, formatMoney } from "./utils";

export interface RewardResult {
  /** True when the referrer was actually paid. */
  paid: boolean;
  referrerId?: number;
  amount?: number;
}

/**
 * Pays the referrer once their invitee becomes a paying customer.
 *
 * Called after a wallet deposit is approved and after an order is delivered —
 * whichever happens first wins, because `claimReferralReward` flips a flag in
 * the database before any money moves. Every later call is a no-op.
 *
 * A reward of 0 (or less) switches the programme off: the claim is still made,
 * so the shop never pays out later if the amount is raised.
 */
export async function payReferralReward(inviteeId: number): Promise<RewardResult> {
  const claimed = await claimReferralReward(inviteeId);
  if (!claimed) return { paid: false };

  const invitee = await getUser(inviteeId);
  const referrerId = invitee?.referred_by;
  if (!referrerId) return { paid: false };

  const shop = await getShopInfo();
  if (shop.referralReward <= 0) return { paid: false };

  await creditBalance(referrerId, shop.referralReward);

  await safeSend(
    referrerId,
    `<b>Referral reward</b>\n\n` +
      `${escapeHtml(invitee?.first_name ?? "Someone you invited")} just made their first purchase, ` +
      `so ${formatMoney(shop.referralReward)} has been added to your wallet.`,
    { parse_mode: "HTML" }
  );

  return { paid: true, referrerId, amount: shop.referralReward };
}
