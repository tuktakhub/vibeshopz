import "./env";

/** Reads an environment variable and treats blank strings as "not set". */
function read(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function required(name: string): string {
  const value = read(name);
  if (!value) {
    throw new Error(
      `[config] Missing required environment variable "${name}". ` +
        `Set it in your local .env file, and in Vercel under ` +
        `Project Settings -> Environment Variables for production.`
    );
  }
  return value;
}

function intFromEnv(name: string, fallback: number): number {
  const value = read(name);
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function idList(name: string): number[] {
  return (read(name) ?? "")
    .split(/[,\s;]+/)
    .map((part) => Number.parseInt(part, 10))
    .filter((id) => Number.isFinite(id) && id > 0);
}

/**
 * Bot configuration.
 *
 * Secrets and connection strings are exposed through getters so that a missing
 * value only throws when it is actually needed. That keeps utility scripts such
 * as `npm run db:init` runnable without a BOT_TOKEN.
 */
export const config = {
  get botToken(): string {
    return required("BOT_TOKEN");
  },
  get webhookSecret(): string {
    return read("WEBHOOK_SECRET") ?? "";
  },
  get publicUrl(): string {
    return (read("PUBLIC_URL") ?? "").replace(/\/+$/, "");
  },

  get tursoUrl(): string {
    return required("TURSO_DATABASE_URL");
  },
  get tursoAuthToken(): string {
    return read("TURSO_AUTH_TOKEN") ?? "";
  },

  get shopName(): string {
    return read("SHOP_NAME") ?? "Digital Store";
  },
  get currencySymbol(): string {
    return read("CURRENCY_SYMBOL") ?? read("CURRENCY") ?? "BDT";
  },
  get supportUsername(): string {
    return read("SUPPORT_USERNAME") ?? "";
  },

  get adminIds(): number[] {
    return idList("ADMIN_IDS");
  },

  /** Fallback payment details, overridable at runtime from the admin panel. */
  paymentDefaults: {
    get methodName(): string {
      return read("PAYMENT_METHOD_NAME") ?? "bKash";
    },
    get number(): string {
      return read("PAYMENT_NUMBER") ?? "";
    },
    get instructions(): string {
      return read("PAYMENT_INSTRUCTIONS") ?? "";
    },
    get note(): string {
      return read("PAYMENT_NOTE") ?? "";
    },
  },

  get productsPerPage(): number {
    return intFromEnv("PRODUCTS_PER_PAGE", 8);
  },
  get ordersPerPage(): number {
    return intFromEnv("ORDERS_PER_PAGE", 8);
  },
};

/** Normalises a support handle so it always renders as `@handle`. */
export function normalizeHandle(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}
