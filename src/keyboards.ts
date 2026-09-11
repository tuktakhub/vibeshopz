import { InlineKeyboard } from "grammy";
import type { Deposit, Order, OrderStatus, PaymentMethod, Product } from "./types";
import {
  depositStatusLabel,
  formatMoney,
  statusLabel,
  truncate,
} from "./utils";

/* ----------------------------- customer --------------------------------- */

/**
 * The welcome grid — the bot's main menu.
 *
 * Laid out two buttons per row. Every destination here is also reachable by
 * command, so the grid is a shortcut rather than the only way in.
 */
export function welcomeMenu(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🛍 Shop Products", "cat:p:0")
    .text("📦 My Orders", "ord:p:0")
    .row()
    .text("💰 My Wallet", "wal:p")
    .text("🚀 My Profile", "prf")
    .row()
    .text("🎁 Refer & Earn", "ref")
    .text("💬 Help & Support", "m:help");
}

/** Kept as an alias so existing screens (empty states, fallbacks) still work. */
export function mainMenu(): InlineKeyboard {
  return welcomeMenu();
}

function paginationRow(
  keyboard: InlineKeyboard,
  prefix: string,
  page: number,
  totalPages: number
): InlineKeyboard {
  if (totalPages <= 1) return keyboard;
  if (page > 0) keyboard.text("« Prev", `${prefix}:${page - 1}`);
  keyboard.text(`${page + 1}/${totalPages}`, "m:noop");
  if (page < totalPages - 1) keyboard.text("Next »", `${prefix}:${page + 1}`);
  return keyboard.row();
}

export function catalogueKeyboard(
  products: Product[],
  page: number,
  totalPages: number
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const product of products) {
    const stockNote =
      product.stock !== null && product.stock <= 0 ? " (sold out)" : "";
    keyboard
      .text(
        `${truncate(product.name, 30)} · ${formatMoney(product.price)}${stockNote}`,
        `cat:v:${product.id}`
      )
      .row();
  }
  paginationRow(keyboard, "cat:p", page, totalPages);
  keyboard.text("Main menu", "m:home");
  return keyboard;
}

export function productDetailKeyboard(productId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("Buy now", `ord:new:${productId}`)
    .row()
    .text("« Back to catalogue", "cat:p:0");
}

export function orderPaymentKeyboard(orderId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("I have paid — send TrxID", `ord:txn:${orderId}`)
    .row()
    .text("Cancel order", `ord:cancel:${orderId}`);
}

export function myOrdersKeyboard(
  orders: Order[],
  page: number,
  totalPages: number
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const order of orders) {
    keyboard
      .text(
        `${order.code} · ${truncate(order.product_name, 20)} · ${statusLabel(order.status)}`,
        `ord:v:${order.id}`
      )
      .row();
  }
  paginationRow(keyboard, "ord:p", page, totalPages);
  keyboard.text("Main menu", "m:home");
  return keyboard;
}

export function orderDetailKeyboard(order: Order): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (order.status === "awaiting_payment") {
    keyboard.text("Send transaction ID", `ord:txn:${order.id}`).row();
    keyboard.text("Cancel order", `ord:cancel:${order.id}`).row();
  } else if (order.status === "rejected") {
    keyboard.text("Send a new transaction ID", `ord:txn:${order.id}`).row();
  }
  keyboard.text("« My orders", "ord:p:0");
  return keyboard;
}

export function cancelWizardKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("Cancel", "m:cancel");
}

/* ------------------------------- admin ---------------------------------- */

export function adminMenu(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Products", "adm:p:list:0")
    .text("Orders", "adm:o:list:all:0")
    .row()
    .text("Pending payments", "adm:o:list:pending:0")
    .text("Deposits", "adm:d:list:0")
    .row()
    .text("Payment methods", "adm:m:list")
    .text("Settings", "adm:s")
    .row()
    .text("Admins", "adm:a:list")
    .text("Refresh stats", "adm:home");
}

export function adminProductsKeyboard(
  products: Product[],
  page: number,
  totalPages: number
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const product of products) {
    const flag = product.active ? "" : "[off] ";
    const stock =
      product.stock === null ? "" : ` · ${product.stock} left`;
    keyboard
      .text(
        `${flag}#${product.id} ${truncate(product.name, 22)}${stock}`,
        `adm:p:view:${product.id}`
      )
      .row();
  }
  paginationRow(keyboard, "adm:p:list", page, totalPages);
  keyboard.text("+ Add product", "adm:p:add").row();
  keyboard.text("« Admin menu", "adm:home");
  return keyboard;
}

export function adminProductKeyboard(product: Product): InlineKeyboard {
  const keyboard = new InlineKeyboard()
    .text("Edit price", `adm:p:field:${product.id}:price`)
    .text("Edit stock", `adm:p:field:${product.id}:stock`)
    .row()
    .text("Edit name", `adm:p:field:${product.id}:name`)
    .text("Edit description", `adm:p:field:${product.id}:description`)
    .row()
    .text("Edit category", `adm:p:field:${product.id}:category`)
    .text("Delivery content", `adm:p:delivery:${product.id}`)
    .row()
    .text(product.active ? "Disable product" : "Enable product", `adm:p:toggle:${product.id}`)
    .row()
    .text("Delete product", `adm:p:delete:${product.id}`)
    .row()
    .text("« Back to products", "adm:p:list:0");
  return keyboard;
}

export function adminDeliveryKeyboard(productId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("Replace file", `adm:p:upload:${productId}`)
    .text("Edit text", `adm:p:text:${productId}`)
    .row()
    .text("Change delivery type", `adm:p:types:${productId}`)
    .text("Remove file", `adm:p:unfile:${productId}`)
    .row()
    .text("« Back to product", `adm:p:view:${productId}`);
}

export function deliveryTypeKeyboard(
  productId: number | null,
  prefixForWizard: "adm:p:addtype" | "adm:p:settype"
): InlineKeyboard {
  const suffix = productId === null ? "" : `:${productId}`;
  const keyboard = new InlineKeyboard()
    .text("Telegram file", `${prefixForWizard}:file${suffix}`)
    .text("Text / link", `${prefixForWizard}:text${suffix}`)
    .row()
    .text("File + text", `${prefixForWizard}:both${suffix}`)
    .row();
  keyboard.text(
    "« Back",
    productId === null ? "adm:p:addcancel" : `adm:p:delivery:${productId}`
  );
  return keyboard;
}

export function adminOrderKeyboard(
  order: Order,
  backTo: "pending" | "all"
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (order.status === "awaiting_payment" || order.status === "awaiting_review") {
    keyboard.text("Approve & deliver", `adm:o:approve:${order.id}:${backTo}`).row();
    keyboard.text("Reject payment", `adm:o:reject:${order.id}:${backTo}`).row();
  }
  keyboard.text("« Back to orders", `adm:o:list:${backTo}:0`);
  return keyboard;
}

/** Single-button keyboard used to escape a free-text admin prompt. */
export function cancelActionKeyboard(callbackData: string): InlineKeyboard {
  return new InlineKeyboard().text("Cancel", callbackData);
}

export function adminOrdersKeyboard(
  orders: Order[],
  scope: "pending" | "all",
  page: number,
  totalPages: number
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const order of orders) {
    keyboard
      .text(
        `${order.code} · ${statusLabel(order.status)} · ${formatMoney(order.price)}`,
        `adm:o:view:${order.id}:${scope}`
      )
      .row();
  }
  paginationRow(keyboard, `adm:o:list:${scope}`, page, totalPages);
  if (scope === "pending") {
    keyboard.text("All orders", "adm:o:list:all:0").row();
  } else {
    keyboard.text("Pending only", "adm:o:list:pending:0").row();
  }
  keyboard.text("« Admin menu", "adm:home");
  return keyboard;
}

export function confirmDeleteKeyboard(productId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("Yes, delete it", `adm:p:deleteok:${productId}`)
    .row()
    .text("Cancel", `adm:p:view:${productId}`);
}

export function adminSettingsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Shop name", "adm:s:edit:shop_name")
    .row()
    .text("Support username", "adm:s:edit:support_username")
    .row()
    .text("Payment method", "adm:s:edit:payment_method_name")
    .row()
    .text("Payment number", "adm:s:edit:payment_number")
    .row()
    .text("Payment instructions", "adm:s:edit:payment_instructions")
    .row()
    .text("Payment note", "adm:s:edit:payment_note")
    .row()
    .text("Minimum deposit", "adm:s:edit:min_deposit")
    .row()
    .text("Referral reward", "adm:s:edit:referral_reward")
    .row()
    .text("« Admin menu", "adm:home");
}

export function adminAdminsKeyboard(ids: number[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const id of ids) {
    keyboard.text(`Remove ${id}`, `adm:a:del:${id}`).row();
  }
  keyboard.text("+ Add admin", "adm:a:add").row();
  keyboard.text("« Admin menu", "adm:home");
  return keyboard;
}

export function backToAdminKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("« Admin menu", "adm:home");
}

export const ORDER_STATUSES: OrderStatus[] = [
  "awaiting_payment",
  "awaiting_review",
  "delivered",
  "rejected",
  "cancelled",
];

/* --------------------------- wallet and profile -------------------------- */

export function walletKeyboard(hasDeposits: boolean): InlineKeyboard {
  const keyboard = new InlineKeyboard().text("💰 Add money", "wal:add").row();
  if (hasDeposits) keyboard.text("🧾 Deposit history", "wal:hist:0").row();
  keyboard.text("🛍 Shop Products", "cat:p:0").row();
  keyboard.text("« Main menu", "m:home");
  return keyboard;
}

/**
 * Quick top-up amounts derived from the shop minimum, so the buttons stay
 * sensible whatever the admin sets. Free entry is always offered too.
 */
export function depositAmountKeyboard(
  minDeposit: number,
  methodId: number
): InlineKeyboard {
  const presets = [minDeposit, minDeposit * 2, minDeposit * 5, minDeposit * 10];
  const keyboard = new InlineKeyboard();

  presets.forEach((amount, index) => {
    keyboard.text(formatMoney(amount), `wal:amt:${amount}:${methodId}`);
    if (index % 2 === 1) keyboard.row();
  });
  if (presets.length % 2 === 1) keyboard.row();

  keyboard.text("✏️ Other amount", `wal:amt:custom:${methodId}`).row();
  keyboard.text("« Back", "wal:add");
  return keyboard;
}

export function depositPaymentKeyboard(depositId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ I have paid — send TrxID", `wal:txn:${depositId}`)
    .row()
    .text("Cancel deposit", `wal:cancel:${depositId}`);
}

export function profileKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("💰 My Wallet", "wal:p")
    .text("📦 My Orders", "ord:p:0")
    .row()
    .text("🎁 Refer & Earn", "ref")
    .row()
    .text("« Main menu", "m:home");
}

/** `shareUrl` is a t.me/share link, so the invite can be forwarded anywhere. */
export function referralKeyboard(shareUrl: string): InlineKeyboard {
  return new InlineKeyboard()
    .url("📤 Share invite link", shareUrl)
    .row()
    .text("💰 My Wallet", "wal:p")
    .row()
    .text("« Main menu", "m:home");
}

export function depositsKeyboard(
  deposits: Deposit[],
  page: number,
  totalPages: number
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const deposit of deposits) {
    keyboard
      .text(
        `${deposit.code} · ${formatMoney(deposit.amount)} · ${depositStatusLabel(deposit.status)}`,
        `wal:v:${deposit.id}`
      )
      .row();
  }
  paginationRow(keyboard, "wal:hist", page, totalPages);
  keyboard.text("« Back to wallet", "wal:p");
  return keyboard;
}

/* --------------------------- admin: deposits ----------------------------- */

export function adminDepositsKeyboard(
  deposits: Deposit[],
  page: number,
  totalPages: number
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const deposit of deposits) {
    keyboard
      .text(
        `${deposit.code} · ${formatMoney(deposit.amount)} · ${depositStatusLabel(deposit.status)}`,
        `adm:d:view:${deposit.id}`
      )
      .row();
  }
  paginationRow(keyboard, "adm:d:list", page, totalPages);
  keyboard.text("« Admin menu", "adm:home");
  return keyboard;
}

export function adminDepositKeyboard(deposit: Deposit): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (deposit.status === "awaiting_payment" || deposit.status === "awaiting_review") {
    keyboard.text("✅ Approve & credit", `adm:d:approve:${deposit.id}`).row();
    keyboard.text("❌ Reject", `adm:d:reject:${deposit.id}`).row();
  }
  keyboard.text("« Back to deposits", "adm:d:list:0");
  return keyboard;
}

/* --------------------------- payment methods ----------------------------- */

/** One method per row, mirroring the wallet screen in the reference design. */
export function paymentMethodKeyboard(methods: PaymentMethod[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const method of methods) {
    keyboard.text(`${method.emoji} ${method.name}`, `wal:m:${method.id}`).row();
  }
  keyboard.text("« Back to wallet", "wal:p");
  return keyboard;
}

export function adminMethodsKeyboard(methods: PaymentMethod[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const method of methods) {
    const flag = method.active ? "" : "[off] ";
    keyboard
      .text(`${flag}${method.emoji} ${truncate(method.name, 26)}`, `adm:m:view:${method.id}`)
      .row();
  }
  keyboard.text("+ Add payment method", "adm:m:add").row();
  keyboard.text("« Admin menu", "adm:home");
  return keyboard;
}

export function adminMethodKeyboard(method: PaymentMethod): InlineKeyboard {
  return new InlineKeyboard()
    .text("Edit name", `adm:m:field:${method.id}:name`)
    .text("Edit icon", `adm:m:field:${method.id}:emoji`)
    .row()
    .text("Edit details", `adm:m:field:${method.id}:instructions`)
    .row()
    .text(method.active ? "Disable" : "Enable", `adm:m:toggle:${method.id}`)
    .text("Delete", `adm:m:delete:${method.id}`)
    .row()
    .text("« Back to methods", "adm:m:list");
}

export function confirmMethodDeleteKeyboard(methodId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("Yes, delete it", `adm:m:deleteok:${methodId}`)
    .row()
    .text("Keep it", `adm:m:view:${methodId}`);
}
