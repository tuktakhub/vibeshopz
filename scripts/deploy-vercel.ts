/**
 * One-command Vercel deployment.
 *
 *   npm run deploy
 *
 * It will:
 *   1. check that the Vercel CLI is logged in
 *   2. link (or create) the `vibeshopz` project
 *   3. push every value from your local .env into the Production environment
 *   4. deploy to production
 *   5. register the Telegram webhook against the deployed URL
 *
 * Values are written to the CLI over stdin as UTF-8, so characters such as the
 * Taka sign in CURRENCY_SYMBOL survive intact (piping them through a Windows
 * shell would corrupt them).
 *
 * Flags:
 *   --no-webhook   deploy only; skip step 5
 *   --project=NAME override the Vercel project name (default: vibeshopz)
 */
import "../src/env";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ARGS = process.argv.slice(2);

const PROJECT =
  ARGS.find((a) => a.startsWith("--project="))?.slice("--project=".length) ||
  "vibeshopz";

const SET_WEBHOOK = !ARGS.includes("--no-webhook");

/** Sent to Vercel only if present and non-empty in .env. */
const ENV_KEYS = [
  "BOT_TOKEN",
  "TURSO_DATABASE_URL",
  "TURSO_AUTH_TOKEN",
  "WEBHOOK_SECRET",
  "ADMIN_IDS",
  "SHOP_NAME",
  "CURRENCY",
  "CURRENCY_SYMBOL",
  "SUPPORT_USERNAME",
  "PAYMENT_METHOD_NAME",
  "PAYMENT_NUMBER",
  "PAYMENT_INSTRUCTIONS",
  "PAYMENT_NOTE",
  "PRODUCTS_PER_PAGE",
  "ORDERS_PER_PAGE",
];

const REQUIRED = ["BOT_TOKEN", "TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN"];

/* ------------------------------- helpers -------------------------------- */

/** Minimal .env parser that preserves UTF-8 and keeps values private. */
function parseEnvFile(filePath: string): Map<string, string> {
  const values = new Map<string, string>();
  if (!fs.existsSync(filePath)) return values;

  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values.set(key, value);
  }
  return values;
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(command: string, input?: string): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      shell: true,
      cwd: process.cwd(),
      env: process.env,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => resolve({ code: -1, stdout, stderr: stderr + String(error) }));
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));

    if (input !== undefined) child.stdin.write(input, "utf8");
    child.stdin.end();
  });
}

function step(message: string): void {
  console.log(`\n== ${message}`);
}

function fail(message: string): never {
  console.error(`\nFAILED: ${message}`);
  process.exit(1);
}

/**
 * Finds the project's stable production domain (e.g. `my-shop.vercel.app`).
 *
 * `vercel deploy` prints the build-specific URL, which contains a hash and sits
 * behind Vercel's deployment protection — Telegram gets a 401 from it. The
 * stable alias is the one a webhook must use.
 *
 * Requires VERCEL_TOKEN; returns undefined when the CLI is authenticated through
 * `vercel login` instead, in which case the caller warns about the fallback.
 */
async function resolveStableDomain(project: string): Promise<string | undefined> {
  const token = process.env.VERCEL_TOKEN;
  if (!token) return undefined;

  try {
    const response = await fetch(`https://api.vercel.com/v9/projects/${project}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return undefined;

    const data = (await response.json()) as {
      latestDeployments?: { alias?: string[] }[];
    };
    const aliases = (data.latestDeployments?.[0]?.alias ?? []).filter((alias) =>
      alias.endsWith(".vercel.app")
    );
    if (aliases.length === 0) return undefined;

    // The team-scoped alias is always longer than the bare project one.
    return aliases.sort((a, b) => a.length - b.length)[0];
  } catch {
    return undefined;
  }
}

/* -------------------------------- main ---------------------------------- */

async function main(): Promise<void> {
  const env = parseEnvFile(path.join(process.cwd(), ".env"));

  if (env.size === 0) {
    fail(
      "No .env file found in this folder.\n" +
        "Copy .env.example to .env and fill in BOT_TOKEN, TURSO_DATABASE_URL and TURSO_AUTH_TOKEN first."
    );
  }

  const missing = REQUIRED.filter((key) => !env.get(key));
  if (missing.length > 0) {
    fail(`These required values are empty in .env: ${missing.join(", ")}`);
  }

  step("Checking the Vercel CLI login");
  if (process.env.VERCEL_TOKEN) {
    // Loaded from .env by src/env.ts — keeps the token off the command line.
    console.log("using VERCEL_TOKEN from .env");
  }
  const whoami = await run("vercel whoami");
  if (whoami.code !== 0) {
    console.error(whoami.stdout + whoami.stderr);
    fail(
      "The Vercel CLI is not logged in.\n\n" +
        "Run `vercel login` in your own terminal (it opens a browser), then run `npm run deploy` again.\n" +
        "Alternatively run this whole thing with `vercel --token <token> ...`, or set the VERCEL_TOKEN environment variable."
    );
  }
  console.log(`logged in as ${whoami.stdout.trim().split("\n").pop()}`);

  step(`Linking the Vercel project "${PROJECT}"`);
  const link = await run(`vercel link --yes --project ${PROJECT}`);
  if (link.code !== 0) {
    console.error(link.stdout + link.stderr);
    fail("Could not link or create the Vercel project.");
  }
  console.log("project linked");

  step("Uploading environment variables (Production)");
  let uploaded = 0;
  for (const key of ENV_KEYS) {
    const value = env.get(key);
    if (!value) {
      console.log(`  skipped ${key} (not set in .env)`);
      continue;
    }

    // Remove any previous value so `env add` never hits a duplicate-name error.
    await run(`vercel env rm ${key} production --yes`);

    const added = await run(`vercel env add ${key} production`, value);
    if (added.code !== 0) {
      console.error(added.stdout + added.stderr);
      fail(`Could not upload ${key}.`);
    }
    uploaded += 1;
    console.log(`  set ${key}`);
  }
  console.log(`${uploaded} variable(s) uploaded.`);

  step("Deploying to production");
  const deploy = await run("vercel deploy --prod --yes");
  const output = `${deploy.stdout}\n${deploy.stderr}`;
  if (deploy.code !== 0) {
    console.error(output);
    fail("The deployment failed. The full log is above.");
  }

  const urls = output.match(/https:\/\/[^\s]+/g) ?? [];
  const deploymentUrl = urls.length > 0 ? urls[urls.length - 1]!.replace(/[.,)]+$/, "") : "";
  if (!deploymentUrl) {
    console.log(output);
    fail("The deployment succeeded but no URL could be read from the output.");
  }
  console.log(`deployed: ${deploymentUrl}`);

  // Prefer the stable production domain over the build-specific URL.
  const stableDomain = await resolveStableDomain(PROJECT);
  const publicBase = stableDomain ? `https://${stableDomain}` : deploymentUrl;

  if (stableDomain) {
    console.log(`stable domain: ${publicBase}`);
  } else {
    console.warn(
      "\nWARNING: could not resolve the stable production domain, so the webhook will\n" +
        "point at the build-specific URL. That URL is behind Vercel deployment\n" +
        "protection and Telegram will receive a 401 from it. Re-point the webhook with:\n" +
        "  npm run webhook:set -- https://<your-project>.vercel.app"
    );
  }

  if (!SET_WEBHOOK) {
    console.log(
      `\nSkipped the webhook. Register it yourself with:\n  npm run webhook:set -- ${publicBase}`
    );
    return;
  }

  step("Registering the Telegram webhook");
  const token = env.get("BOT_TOKEN")!;
  const secret = env.get("WEBHOOK_SECRET") ?? "";
  const webhookUrl = `${publicBase.replace(/\/+$/, "")}/api/webhook`;

  const body: Record<string, unknown> = {
    url: webhookUrl,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  };
  if (secret) body.secret_token = secret;

  const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json()) as { ok: boolean; description?: string };
  if (!result.ok) fail(`Telegram rejected the webhook: ${result.description}`);
  console.log(`webhook set to ${webhookUrl}`);

  const infoResponse = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
  const info = (await infoResponse.json()) as {
    ok: boolean;
    result?: { url?: string; pending_update_count?: number; last_error_message?: string };
  };
  if (info.ok && info.result) {
    console.log(`  url       : ${info.result.url}`);
    console.log(`  last error: ${info.result.last_error_message ?? "(none)"}`);
  }

  console.log(
    `\nDone. Open ${publicBase}/api/health to confirm the database connection,\n` +
      `then send /admin to your bot in Telegram.`
  );
}

main().catch((error) => {
  console.error("Unexpected error:", error);
  process.exit(1);
});
