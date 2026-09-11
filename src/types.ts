/** How a product is handed over to the buyer once an order is approved. */
export type DeliveryType = "file" | "text" | "both";

/**
 * Order lifecycle:
 *
 *   awaiting_payment -> buyer has an open order but has not sent a TrxID yet
 *   awaiting_review  -> buyer submitted a TrxID, an admin has to approve it
 *   delivered        -> approved and the product was sent automatically
 *   rejected         -> admin rejected the payment (reason in admin_note)
 *   cancelled        -> buyer or admin cancelled the order
 */
export type OrderStatus =
  | "awaiting_payment"
  | "awaiting_review"
  | "delivered"
  | "rejected"
  | "cancelled";

export interface Product {
  id: number;
  name: string;
  description: string;
  price: number;
  currency: string;
  category: string | null;
  active: number;
  delivery_type: DeliveryType;
  file_id: string | null;
  file_name: string | null;
  delivery_text: string | null;
  /** null means unlimited stock. */
  stock: number | null;
  created_at: string;
  updated_at: string;
}

export interface Order {
  id: number;
  code: string;
  user_id: number;
  username: string | null;
  first_name: string | null;
  product_id: number;
  product_name: string;
  price: number;
  currency: string;
  status: OrderStatus;
  txn_id: string | null;
  sender_number: string | null;
  admin_note: string | null;
  created_at: string;
  updated_at: string;
  delivered_at: string | null;
  /** 1 when the order was paid from the wallet instead of a manual transfer. */
  paid_from_balance: number;
}

export interface ShopUser {
  user_id: number;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  /** Wallet balance, in the shop currency. */
  balance: number;
  /** Short code used to build this user's invite link. */
  referral_code: string | null;
  /** Telegram id of the user who invited them, if any. */
  referred_by: number | null;
  /** 1 once the referrer has been paid for bringing this user in. */
  referral_rewarded: number;
  created_at: string;
  last_seen_at: string | null;
}

/**
 * Deposit lifecycle, mirroring orders:
 *
 *   awaiting_payment -> the amount is chosen but no TrxID was sent yet
 *   awaiting_review  -> a TrxID was submitted and an admin has to check it
 *   approved         -> the amount was credited to the wallet
 *   rejected         -> an admin rejected the transfer (reason in admin_note)
 *   cancelled        -> the buyer abandoned the deposit
 */
export type DepositStatus =
  | "awaiting_payment"
  | "awaiting_review"
  | "approved"
  | "rejected"
  | "cancelled";

export interface Deposit {
  id: number;
  code: string;
  user_id: number;
  amount: number;
  currency: string;
  status: DepositStatus;
  txn_id: string | null;
  admin_note: string | null;
  /** Payment method chosen at the time; the name is copied so history survives deletion. */
  method_id: number | null;
  method_name: string | null;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
}

/** A top-up channel the admin offers, e.g. bKash, Binance Pay, USDT (BEP20). */
export interface PaymentMethod {
  id: number;
  name: string;
  emoji: string;
  /** Where to send the money — number, address, or any free-form detail. */
  instructions: string;
  active: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}
