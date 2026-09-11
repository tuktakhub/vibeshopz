import { config } from "./config";
import type { DeliveryType, DepositStatus, OrderStatus } from "./types";

/** Ambiguous characters (0/O, 1/I) are omitted so codes can be read aloud. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomCode(length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

/** Human-friendly, ambiguity-free order code such as `ORD-7K2M9Q`. */
export function generateOrderCode(prefix = "ORD"): string {
  return `${prefix}-${randomCode(6)}`;
}

/** Short code behind a user's invite link, e.g. `K7M2QX`. */
export function generateReferralCode(): string {
  return randomCode(6);
}

export function formatMoney(amount: number, symbol = config.currencySymbol): string {
  const value = Number(amount) || 0;
  const formatted = Number.isInteger(value)
    ? value.toLocaleString("en-US")
    : value.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
  return `${symbol}${formatted}`;
}

/** Escapes text for Telegram's HTML parse mode. */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function truncate(input: string, max: number): string {
  const clean = input.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, Math.max(0, max - 1))}…`;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function pageCount(total: number, perPage: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, perPage)));
}

export function clampPage(page: number, totalPages: number): number {
  if (!Number.isFinite(page)) return 0;
  return Math.min(Math.max(0, Math.trunc(page)), Math.max(0, totalPages - 1));
}

const STATUS_LABELS: Record<OrderStatus, string> = {
  awaiting_payment: "Awaiting payment",
  awaiting_review: "Under review",
  delivered: "Delivered",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status as OrderStatus] ?? status;
}

const DEPOSIT_STATUS_LABELS: Record<DepositStatus, string> = {
  awaiting_payment: "Awaiting payment",
  awaiting_review: "Under review",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

export function depositStatusLabel(status: string): string {
  return DEPOSIT_STATUS_LABELS[status as DepositStatus] ?? status;
}

const DELIVERY_LABELS: Record<DeliveryType, string> = {
  file: "Telegram file",
  text: "Text / link",
  both: "File + text",
};

export function deliveryLabel(type: string): string {
  return DELIVERY_LABELS[type as DeliveryType] ?? type;
}

/** `2026-09-11 10:17:00` -> `11 Sep 2026, 10:17` (times are stored in UTC). */
export function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const normalised = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalised);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

export function mention(
  firstName: string | null,
  username: string | null,
  userId: number
): string {
  const handle = username ? ` (@${username})` : "";
  return `${escapeHtml(firstName ?? "User")}${escapeHtml(handle)} · <code>${userId}</code>`;
}

export function isNumeric(input: string): boolean {
  return /^\d+(\.\d+)?$/.test(input.trim());
}
