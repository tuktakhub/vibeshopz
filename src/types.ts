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
}

export interface ShopUser {
  user_id: number;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  created_at: string;
  last_seen_at: string | null;
}
