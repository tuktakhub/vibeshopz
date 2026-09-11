import type { Order, Product } from "./types";
import type { ShopInfo } from "./settings";
import {
  escapeHtml,
  formatDateTime,
  formatMoney,
  mention,
  statusLabel,
} from "./utils";

/* ------------------------------ customer -------------------------------- */

export function welcome(shop: ShopInfo): string {
  return (
    `<b>${escapeHtml(shop.shopName)}</b>\n\n` +
    `Digital products, delivered instantly after your payment is confirmed.\n\n` +
    `<b>How it works</b>\n` +
    `1. Pick a product from the catalogue\n` +
    `2. Pay manually to the number shown at checkout\n` +
    `3. Send the transaction ID (TrxID) here\n` +
    `4. An admin verifies the payment and the product is delivered automatically\n\n` +
    `Use the buttons below, or the commands /products, /orders, /support.`
  );
}

export function helpText(shop: ShopInfo): string {
  const support = shop.supportUsername
    ? `\nSupport: ${escapeHtml(shop.supportUsername)}`
    : "";

  return (
    `<b>How ${escapeHtml(shop.shopName)} works</b>\n\n` +
    `<b>1. Choose a product</b>\n` +
    `Tap “Browse products” to see everything on sale. Each listing shows the price and what you receive.\n\n` +
    `<b>2. Pay manually</b>\n` +
    `When you tap “Buy now” the bot creates an order and shows you the payment ${escapeHtml(
      shop.paymentMethodName
    )} number and instructions.\n\n` +
    `<b>3. Send your transaction ID</b>\n` +
    `After paying, tap “I have paid” and send the TrxID from your payment confirmation.\n\n` +
    `<b>4. Approval and delivery</b>\n` +
    `An admin checks the payment. Once approved, the product is sent to you here automatically and the order shows as Delivered.\n\n` +
    `<b>Commands</b>\n` +
    `/products — browse the catalogue\n` +
    `/orders — your orders and their status\n` +
    `/support — contact the shop\n` +
    `/cancel — stop what you are doing\n` +
    `/id — show your Telegram ID${support}`
  );
}

export function supportText(shop: ShopInfo): string {
  const lines = [
    `<b>${escapeHtml(shop.shopName)} support</b>`,
    "",
    shop.supportUsername
      ? `Message us at ${escapeHtml(shop.supportUsername)}.`
      : "No support contact has been configured yet. Contact the shop owner from the account that sent you this bot.",
  ];
  if (shop.paymentNumber) {
    lines.push("", `Payment number: <code>${escapeHtml(shop.paymentNumber)}</code>`);
  }
  lines.push(
    "",
    "Have your order code (for example ORD-7K2M9Q) ready — it makes things much faster."
  );
  return lines.join("\n");
}

export function emptyCatalogue(shop: ShopInfo): string {
  return (
    `<b>Catalogue</b>\n\n` +
    `No products are on sale right now. Please check back later` +
    (shop.supportUsername ? ` or message ${escapeHtml(shop.supportUsername)}` : "") +
    `.`
  );
}

export function catalogueHeader(shop: ShopInfo, count: number): string {
  return (
    `<b>${escapeHtml(shop.shopName)} — catalogue</b>\n\n` +
    `${count} product${count === 1 ? "" : "s"} available. Tap one to see the details.`
  );
}

export function productDetail(product: Product): string {
  const lines = [
    `<b>${escapeHtml(product.name)}</b>`,
    `Price: <b>${formatMoney(product.price)}</b>`,
  ];
  if (product.category) lines.push(`Category: ${escapeHtml(product.category)}`);
  if (product.stock !== null) {
    lines.push(
      product.stock > 0 ? `In stock: ${product.stock}` : "Status: sold out"
    );
  }
  lines.push(
    "",
    escapeHtml(product.description || "No description provided."),
    "",
    "What you receive: " +
      (product.delivery_type === "file"
        ? "a downloadable file sent to you on Telegram"
        : product.delivery_type === "both"
          ? "a file plus access details sent to you on Telegram"
          : "access details / download link sent to you on Telegram")
  );
  return lines.join("\n");
}

export function orderCreated(order: Order, shop: ShopInfo): string {
  const lines = [
    `<b>Order ${escapeHtml(order.code)} created</b>`,
    "",
    `Product: <b>${escapeHtml(order.product_name)}</b>`,
    `Amount: <b>${formatMoney(order.price)}</b>`,
    `Status: ${statusLabel(order.status)}`,
    "",
    `To complete the purchase, send <b>${formatMoney(order.price)}</b> with ${escapeHtml(
      shop.paymentMethodName
    )}.`,
  ];

  if (shop.paymentNumber) {
    lines.push("", `<b>${escapeHtml(shop.paymentMethodName)}:</b> <code>${escapeHtml(shop.paymentNumber)}</code>`);
  }
  if (shop.paymentInstructions) {
    lines.push("", escapeHtml(shop.paymentInstructions));
  }
  if (shop.paymentNote) {
    lines.push("", `<i>${escapeHtml(shop.paymentNote)}</i>`);
  }

  lines.push(
    "",
    "Once you have paid, tap <b>“I have paid — send TrxID”</b> and send the transaction ID from your confirmation message."
  );

  return lines.join("\n");
}

export function askTxnId(order: Order): string {
  return (
    `<b>Order ${escapeHtml(order.code)}</b>\n\n` +
    `Send the transaction ID (TrxID) you received after paying ${formatMoney(order.price)}.\n\n` +
    `Example: <code>9F7K2LM4QX</code>`
  );
}

export function invalidTxnId(): string {
  return (
    `That does not look like a transaction ID. Please send the ID exactly as it ` +
    `appears in your payment confirmation — letters and digits only (at least 4 characters).\n\n` +
    `Send /cancel to stop.`
  );
}

export function txnReceived(order: Order): string {
  return (
    `<b>Order ${escapeHtml(order.code)} is under review</b>\n\n` +
    `We received your transaction ID <code>${escapeHtml(order.txn_id ?? "")}</code>.\n\n` +
    `An admin will verify the payment shortly. Once it is approved, your product ` +
    `will be delivered here automatically. You can check the status any time with /orders.`
  );
}

export function txnRejectedNotice(order: Order): string {
  return (
    `<b>Order ${escapeHtml(order.code)} was not approved</b>\n\n` +
    `Product: ${escapeHtml(order.product_name)}\n` +
    (order.admin_note ? `Reason: ${escapeHtml(order.admin_note)}\n` : "") +
    `\nIf you paid and think this is a mistake, send a new transaction ID and the ` +
    `team will take another look.`
  );
}

export function orderCancelled(order: Order): string {
  return `<b>Order ${escapeHtml(order.code)} cancelled.</b> Nothing was charged.`;
}

export function ordersHeader(count: number): string {
  if (count === 0) {
    return "<b>My orders</b>\n\nYou have not placed any orders yet. Use /products to browse the catalogue.";
  }
  return `<b>My orders</b>\n\n${count} order${count === 1 ? "" : "s"}. Tap one for the details.`;
}

export function orderDetails(order: Order): string {
  const lines = [
    `<b>Order ${escapeHtml(order.code)}</b>`,
    "",
    `Product: <b>${escapeHtml(order.product_name)}</b>`,
    `Amount: <b>${formatMoney(order.price)}</b>`,
    `Status: <b>${statusLabel(order.status)}</b>`,
    `Placed: ${formatDateTime(order.created_at)} UTC`,
  ];
  if (order.txn_id) lines.push(`TrxID: <code>${escapeHtml(order.txn_id)}</code>`);
  if (order.delivered_at) {
    lines.push(`Delivered: ${formatDateTime(order.delivered_at)} UTC`);
  }
  if (order.admin_note) lines.push(`Admin note: ${escapeHtml(order.admin_note)}`);
  return lines.join("\n");
}

export function cancelledWizard(): string {
  return "Cancelled. Nothing was changed.";
}

export function mainMenuText(shop: ShopInfo): string {
  return (
    `<b>${escapeHtml(shop.shopName)}</b>\n\n` +
    `Browse the catalogue, place an order and pay manually. As soon as an admin ` +
    `confirms your payment, the product is delivered to you automatically.`
  );
}

/* -------------------------------- admin --------------------------------- */

export function adminPanel(stats: {
  products: number;
  pending: number;
  delivered: number;
  revenue: number;
}): string {
  return (
    `<b>Admin panel</b>\n\n` +
    `Products: <b>${stats.products}</b>\n` +
    `Payments waiting: <b>${stats.pending}</b>\n` +
    `Orders delivered: <b>${stats.delivered}</b>\n` +
    `Revenue (delivered): <b>${formatMoney(stats.revenue)}</b>\n\n` +
    `Pick a section below.`
  );
}

export function adminProductDetail(product: Product): string {
  const lines = [
    `<b>#${product.id} — ${escapeHtml(product.name)}</b>`,
    "",
    `Price: <b>${formatMoney(product.price)}</b>`,
    `Category: ${escapeHtml(product.category ?? "—")}`,
    `Stock: ${product.stock === null ? "unlimited" : product.stock}`,
    `Active: ${product.active ? "yes" : "no"}`,
    `Delivery: ${escapeHtml(product.delivery_type)}`,
    "",
    `<b>Description</b>`,
    escapeHtml(product.description || "—"),
  ];
  return lines.join("\n");
}

export function adminNewPayment(order: Order): string {
  return (
    `<b>New payment submitted</b>\n\n` +
    `Order: <b>${escapeHtml(order.code)}</b>\n` +
    `Product: ${escapeHtml(order.product_name)}\n` +
    `Amount: <b>${formatMoney(order.price)}</b>\n` +
    `TrxID: <code>${escapeHtml(order.txn_id ?? "")}</code>\n` +
    `Buyer: ${mention(order.first_name, order.username, order.user_id)}\n` +
    `Placed: ${formatDateTime(order.created_at)} UTC\n\n` +
    `Approve to deliver the product automatically, or reject to ask for a new transaction ID.`
  );
}

export function adminOrderDetail(order: Order): string {
  const lines = [
    `<b>Order ${escapeHtml(order.code)}</b> (id ${order.id})`,
    "",
    `Product: ${escapeHtml(order.product_name)} (id ${order.product_id})`,
    `Amount: <b>${formatMoney(order.price)}</b>`,
    `Status: <b>${statusLabel(order.status)}</b>`,
    `Buyer: ${mention(order.first_name, order.username, order.user_id)}`,
    `Placed: ${formatDateTime(order.created_at)} UTC`,
  ];
  if (order.txn_id) lines.push(`TrxID: <code>${escapeHtml(order.txn_id)}</code>`);
  if (order.sender_number) {
    lines.push(`Sender: <code>${escapeHtml(order.sender_number)}</code>`);
  }
  if (order.delivered_at) {
    lines.push(`Delivered: ${formatDateTime(order.delivered_at)} UTC`);
  }
  if (order.admin_note) lines.push(`Note: ${escapeHtml(order.admin_note)}`);
  return lines.join("\n");
}

export function adminOrdersHeader(
  scope: "pending" | "all",
  count: number
): string {
  if (count === 0) {
    return scope === "pending"
      ? "<b>Pending payments</b>\n\nNothing is waiting for review."
      : "<b>All orders</b>\n\nNo orders yet.";
  }
  return scope === "pending"
    ? `<b>Pending payments</b>\n\n${count} order${count === 1 ? "" : "s"} waiting for review.`
    : `<b>All orders</b>\n\n${count} order${count === 1 ? "" : "s"}.`;
}

export function adminSettings(current: ShopInfo): string {
  return (
    `<b>Shop settings</b>\n\n` +
    `Shop name: <b>${escapeHtml(current.shopName)}</b>\n` +
    `Support: <b>${escapeHtml(current.supportUsername || "—")}</b>\n` +
    `Payment method: <b>${escapeHtml(current.paymentMethodName)}</b>\n` +
    `Payment number: <code>${escapeHtml(current.paymentNumber || "—")}</code>\n` +
    `Instructions: ${escapeHtml(current.paymentInstructions || "—")}\n` +
    `Note: ${escapeHtml(current.paymentNote || "—")}\n\n` +
    `These values are shown to buyers when they place an order.`
  );
}

export function adminAdmins(ids: number[]): string {
  return (
    `<b>Admins</b>\n\n` +
    ids.map((id) => `• <code>${id}</code>`).join("\n") +
    `\n\nAdmins can manage products, review payments and change settings. ` +
    `Anyone can add themselves by sending /id to the bot.`
  );
}

export function adminProductCreated(product: Product): string {
  return (
    `<b>Product created</b>\n\n` +
    `#${product.id} — ${escapeHtml(product.name)}\n` +
    `Price: ${formatMoney(product.price)}\n` +
    `Delivery: ${escapeHtml(product.delivery_type)}\n\n` +
    `It is live in the catalogue now.`
  );
}
