# Telegram Digital Store Bot

A compact Telegram bot for selling digital products with **manual payment approval**.
Runs as a serverless webhook on **Vercel** and stores everything in **Turso** (libSQL).

The buyer browses a catalogue, pays manually (bKash / Nagad / anything you configure),
sends the transaction ID, and an admin approves it. The product is then delivered
automatically — as a Telegram file, as text/link content, or both.

---

## দ্রুত শুরু (বাংলা)

```bash
npm install
cp .env.example .env      # তারপর .env ফাইলে BOT_TOKEN, TURSO_DATABASE_URL, TURSO_AUTH_TOKEN বসান
npm run db:init           # ডেটাবেসে টেবিল তৈরি করবে
npm test                  # কোনো টোকেন ছাড়াই সব ফ্লো টেস্ট করবে
npm run dev               # লোকালি long-polling মোডে বট চালাবে
```

Vercel-এ ডিপ্লয় করার পর:

```bash
npm run webhook:set -- https://your-app.vercel.app
```

তারপর টেলিগ্রামে বটকে `/id` পাঠিয়ে নিজের আইডি জেনে `ADMIN_IDS`-এ বসান এবং `/admin` দিয়ে প্রোডাক্ট যোগ করুন।

---

## Features

| Feature | How it works |
|---|---|
| Telegram bot | grammY, webhook mode (serverless-friendly) |
| Product catalogue | Paginated inline list of active products |
| Product details | Name, price, category, stock, description, delivery note |
| Manual payment | Payment method, number, instructions and note are configurable at runtime |
| Transaction ID | The buyer submits a TrxID; the bot validates the format |
| Order creation | Unique `ORD-XXXXXX` code, snapshots product name and price |
| Admin approval / rejection | Inline **Approve & deliver** / **Reject payment** buttons with a reason |
| Automatic delivery | Sends the Telegram file and/or the delivery text, then marks the order delivered |
| My Orders | Buyer order history with live status |
| Admin product management | Add wizard, edit price/stock/name/description/category, replace file/text, enable/disable, delete |
| Admin order management | Pending queue, all orders, order detail with buyer and TrxID |
| Turso database | libSQL over HTTP — ideal for serverless |
| Vercel deployment | `api/webhook.ts` function + `vercel.json` |

Everything is in English at runtime, as requested.

---

## Order lifecycle

```text
Buyer picks a product
        |
        v
  Order created ............ awaiting_payment
        |                    (payment details shown)
        |  buyer sends the TrxID
        v
  Admin notified .......... awaiting_review
        |
   +----+----------------------+
   |                           |
 Approve                    Reject (with reason)
   |                           |
   v                           v
 delivered                 rejected  --> buyer may submit a new TrxID
 (file and/or text sent,
  stock decremented)
```

Order statuses: `awaiting_payment`, `awaiting_review`, `delivered`, `rejected`, `cancelled`.

---

## Project structure

```text
api/
  webhook.ts          Telegram webhook endpoint (Vercel serverless function)
  health.ts           Deployment smoke test — checks the Turso connection
  _http.ts            Minimal request/response types (keeps @vercel/node out)
src/
  config.ts           Environment variables, validated lazily
  env.ts              Loads .env locally; skipped on Vercel
  core.ts             The Bot instance and the global error handler
  bot.ts              Registers every handler (order matters)
  db.ts               libSQL client, query helpers, ensureSchema()
  schema.ts           Table definitions + the whitelist of editable settings
  repository.ts       All product / order / user queries
  settings.ts         Runtime settings with env fallbacks
  state.ts            Serverless-safe multi-step wizard state
  admins.ts           Admin resolution (env + database)
  delivery.ts         Sends the purchased product and finalises the order
  notify.ts           Admin notifications that never break a flow
  keyboards.ts        Every inline keyboard
  texts.ts            Every user-facing message
  utils.ts            Money, order codes, escaping, pagination
  dev.ts              Local long-polling entry point
  handlers/
    customer.ts       Buyer commands and buttons
    admin.ts          Admin panel, product and order screens
    wizard.ts         Free-text/document answers for multi-step flows
    render.ts         Edits the current message instead of spamming
scripts/
  init-db.ts          Creates the schema
  seed.ts             Inserts two example products
  set-webhook.ts      Registers / inspects / removes the Telegram webhook
  smoke-test.ts       Tests the database layer on a local file database
  bot-test.ts         Tests the whole bot with a stubbed Telegram API
```

---

## Setup

### 1. Create the bot

1. Open [@BotFather](https://t.me/BotFather) in Telegram.
2. Send `/newbot`, choose a name and a username.
3. Copy the HTTP API token — that is `BOT_TOKEN`.

### 2. Create the Turso database

Install the Turso CLI and log in (see the [Turso quickstart](https://docs.turso.tech/quickstart)), then:

```bash
turso db create digital-store
turso db show --url digital-store          # -> TURSO_DATABASE_URL
turso db tokens create digital-store       # -> TURSO_AUTH_TOKEN
```

### 3. Configure the environment

```bash
cp .env.example .env
```

Fill in `.env`:

| Variable | Required | Purpose |
|---|---|---|
| `BOT_TOKEN` | yes | Token from BotFather |
| `TURSO_DATABASE_URL` | yes | `libsql://…` URL of your database |
| `TURSO_AUTH_TOKEN` | yes for Turso Cloud | Database auth token |
| `WEBHOOK_SECRET` | strongly recommended | Telegram echoes this in `X-Telegram-Bot-Api-Secret-Token`; mismatched requests are rejected |
| `PUBLIC_URL` | optional | Production URL, used by `npm run webhook:set` |
| `SHOP_NAME` | optional | Fallback shop name |
| `CURRENCY_SYMBOL` | optional | Shown next to prices (default `৳`) |
| `SUPPORT_USERNAME` | optional | Fallback support handle |
| `PAYMENT_METHOD_NAME` | optional | Fallback payment method name |
| `PAYMENT_NUMBER` | optional | Fallback payment number |
| `PAYMENT_INSTRUCTIONS` | optional | Fallback checkout instructions |
| `PAYMENT_NOTE` | optional | Fallback reminder under the payment details |
| `ADMIN_IDS` | optional | Comma-separated Telegram IDs that are always admin |
| `PRODUCTS_PER_PAGE`, `ORDERS_PER_PAGE` | optional | Pagination size (default 8) |

The payment and shop values are only **fallbacks** — an admin can change all of them
from `/admin -> Settings`, and the database value wins over `.env`.

### 4. Create the schema

```bash
npm run db:init     # creates tables and indexes
npm run db:seed     # optional: two example products
```

### 5. Try it locally

```bash
npm run dev         # long polling, no public URL needed
```

Send `/start` to your bot. To become an admin, send `/id` and add the number to
`ADMIN_IDS` in `.env`, then restart.

---

## Deploy to Vercel

1. Push the project to a Git repository and import it in Vercel (or run `vercel`).
2. Add the environment variables from your `.env` in
   **Project Settings → Environment Variables** (at minimum `BOT_TOKEN`,
   `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `WEBHOOK_SECRET`, `ADMIN_IDS`).
3. Deploy. Vercel picks up `api/webhook.ts` as a serverless function automatically;
   `npm run build` runs a type check and fails the deploy on a type error.
4. Register the webhook:

   ```bash
   npm run webhook:set -- https://your-app.vercel.app
   ```

   You can also set `PUBLIC_URL` in `.env` and just run `npm run webhook:set`.

5. Verify:

   - `https://your-app.vercel.app/api/health` should return `{"ok":true,"database":"connected",…}`
   - `npm run webhook:info` should show your URL with no `last_error_message`

### One-command alternative

Rather than clicking through the dashboard, `npm run deploy` performs the whole
deployment: it links the project, uploads every non-empty value from `.env` into
the **Production** environment (written as UTF-8, so symbols such as the Taka sign
survive), deploys to production, and registers the Telegram webhook against the
new URL. Values are never echoed to the terminal.

```bash
vercel login     # once, in your own terminal
npm run deploy
```

Flags: `--project=NAME` to use a different Vercel project name, and
`--no-webhook` to deploy without touching the webhook.

### Webhook endpoint

`POST https://your-app.vercel.app/api/webhook`

`vercel.json` sets `maxDuration: 30` for it. Every handler normally finishes in a
few seconds; if your plan caps the duration lower, Vercel will still serve the
request, and Telegram retries anything that does not return a 2xx.

---

## Using the bot

### The welcome grid

`/start` answers with one short line and a button grid, two buttons per row:

```
🎉 Welcome to <Shop>!
[ 🛍 Shop Products ]  [ 📦 My Orders  ]
[ 💰 My Wallet    ]  [ 🚀 My Profile ]
[ 🎁 Refer & Earn ]  [ 💬 Help &       ]
                      [   Support      ]
```

Every destination is also a command, so the grid is a shortcut rather than the
only way in. It is defined once in `welcomeMenu()` (`src/keyboards.ts`); the
screens behind it are ordinary inline callbacks.

> A Telegram message can carry only **one** keyboard, so the grid lives on the
> welcome / help / support screens and every other screen routes back to it.

The `/` command list is published with `setMyCommands` — by `npm run dev` locally
and by `npm run deploy` in production. Admins additionally get an `/admin` entry
scoped to their own chat.

### Wallet, referrals and profile

| Screen | What it does |
|---|---|
| 💰 My Wallet | Balance, deposit history, and a top-up flow: pick a method, then an amount |
| 🚀 My Profile | Name, username, Telegram id, balance, orders, total spent, friends invited |
| 🎁 Refer & Earn | Personal invite link, share button, invited count and the current reward |

**Deposits** run in two steps. The buyer opens **Add funds**, picks a payment
method, then picks an amount. The deposit screen shows that method's own
instructions, the buyer pays and sends the TrxID, and an admin approves it from
`/admin → Deposits`. Approval credits the wallet and messages the buyer. Each
deposit stores the method it used (`deposits.method_id` / `method_name`), so the
admin alert names it even if the method is renamed or removed later.

### Payment methods

Payment methods are data, not code. Manage them from **`/admin → Payment
methods`**:

| Action | What it does |
|---|---|
| **+ Add payment method** | Three steps — name, icon emoji, then the details buyers follow |
| **Edit name / icon / details** | Change one field at a time |
| **Disable / Enable** | Hides it from buyers without losing its history |
| **Delete** | Removes it after a confirmation step |

Active methods appear on the buyer's **Add funds** screen, one per row, in
`sort_order` then `id`. If no method is active buyers see a clear message instead
of an empty screen.

> **Upgrading an existing shop:** the first run after this change creates one
> method automatically from the old `payment_method_name` / `payment_number` /
> `payment_instructions` settings, so nothing breaks mid-flight. It happens once
> — a `payment_methods_seeded` marker in `settings` means deleting every method
> does not bring it back on the next deploy.

**Checkout** spends the wallet first. When the balance covers the price the order is
delivered immediately — no admin, no waiting — and `orders.paid_from_balance`
records how it was paid. The balance check happens inside a single `UPDATE ... WHERE
balance >= ?`, so two fast taps cannot double-spend. If the balance is short, the
normal manual-payment path runs instead.

**Referrals** work through deep links: `https://t.me/<bot>?start=ref_<CODE>`.
Attribution is silent, and the reward is paid to the referrer the first time the
invitee's deposit is approved or their order is delivered — whichever happens
first. `claimReferralReward()` flips a flag in the database *before* any money
moves, so a deposit approval and an order delivery arriving together cannot pay
twice. Set the amount (or switch the programme off with `0`) from
`/admin → Settings → Referral reward`.

### Buyer commands

| Command | Action |
|---|---|
| `/start`, `/menu` | Main menu (the welcome grid) |
| `/shop`, `/products` | Browse the catalogue |
| `/orders` | Order history with statuses |
| `/wallet` | Balance, top-up and deposit history |
| `/profile` | Account summary |
| `/refer` | Invite link and referral stats |
| `/support` | Support contact and payment number |
| `/help` | How ordering works |
| `/cancel` | Abandon the current step |
| `/id` | Show your Telegram ID |

### Admin commands

| Command | Action |
|---|---|
| `/admin` | Admin panel with stats, products, orders, deposits, payment methods, settings, admins |

From the panel you can:

- **Products** — add a product with a 6-step wizard (name, description, price,
  category, stock, delivery type, delivery content), edit any field, replace the
  file, edit the delivery text, change the delivery type, enable/disable, delete.
- **Orders** — pending payments, all orders, order detail, approve & deliver, or
  reject with a reason.
- **Deposits** — review wallet top-ups, approve to credit the balance, or reject
  with a reason.
- **Payment methods** — add, rename, re-icon, rewrite the details, disable or
  delete the methods buyers see on the Add funds screen.
- **Settings** — shop name, support username, payment method, payment number,
  payment instructions, payment note, minimum deposit, referral reward.
- **Admins** — add or remove admins (IDs from `ADMIN_IDS` cannot be removed here).

### Delivery types

| Type | What the buyer receives |
|---|---|
| Telegram file | The document you uploaded to the bot |
| Text / link | A download link, licence key or instructions |
| File + text | Both, one after the other |

Files are delivered by reusing the Telegram `file_id`, so you upload the file to the
bot once (from `/admin -> Products -> … -> Delivery content -> Replace file`).
A `file_id` stays valid for that bot; if you replace the bot token, re-upload the file.

---

## Testing

```bash
npm test              # database smoke test + full bot test + type check
npm run test:local    # database layer only
npm run test:bot      # full buyer journey with a stubbed Telegram API
npm run typecheck     # tsc --noEmit
```

`test:local` creates a throwaway libSQL file database and checks the schema, product
CRUD, the full order lifecycle, settings and wizard state.

`test:bot` pushes synthetic updates through the real bot with every outgoing
Telegram call mocked, so it asserts the whole journey — `/start` → catalogue →
product → order → TrxID → admin approval → automatic delivery → `/orders` — plus
the product wizard, the rejection path, and a button audit that presses **every**
callback the bot renders to prove no button is orphaned. No token or network
access is required.

In total the two scripts run more than 150 assertions.

---

## Notes and limitations

- **Payment verification is manual by design.** The bot records the TrxID and asks
  an admin to confirm it; it does not talk to a payment gateway.
- **Serverless means stateless.** Multi-step flows and settings live in Turso, so a
  cold start in the middle of a wizard is fine.
- **Webhook security.** Set `WEBHOOK_SECRET`. Without it, anyone who learns the URL
  can post fake updates. `npm run webhook:set` warns you when it is empty.
- **Order history is preserved.** Deleting a product does not delete its orders; the
  order keeps the product name and price it was created with.
- **Stock.** Leave stock unlimited (send `unlimited`) for products that never run out.
  Otherwise one unit is deducted on each successful delivery.
- **One instance per token.** Do not run `npm run dev` while the production webhook is
  active — Telegram rejects `getUpdates` when a webhook is set, and the script removes
  the webhook when it starts.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `/api/health` returns `database: "unavailable"` | Wrong `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN`, or the token was rotated. |
| Bot never replies in production | Run `npm run webhook:info`; check for `last_error_message`, and confirm the URL ends with `/api/webhook`. |
| `401 Unauthorized` on the webhook | `WEBHOOK_SECRET` in Vercel does not match the one used when registering the webhook — re-run `npm run webhook:set`. |
| `bootstrap failed` in Vercel logs | The schema could not be created — usually bad Turso credentials. Run `npm run db:init` locally. |
| `/admin` says you are not an admin | Send `/id` to the bot and add that number to `ADMIN_IDS`, then redeploy. |
| "Telegram rejected the stored file id" | Re-upload the file to the product from the admin panel. |
| Delivery worked but the buyer got nothing | The buyer may have blocked the bot; the order stays under review so you can retry. |
| Vercel build fails: `No Output Directory named "public" found` | Keep the empty `public/` directory that ships with the repo. An API-only Vercel project still declares an output directory, and Vercel falls back to `public`. |
| The bot stops responding after a redeploy | The webhook is pointing at a deployment-specific URL (`…-<hash>-….vercel.app`), which is behind Vercel's deployment protection. Point it at the stable production domain instead: `npm run webhook:set -- https://<project>.vercel.app`. |

---

## License

MIT
