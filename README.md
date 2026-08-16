# TallyMyMoney

A personal Telegram bot that reads Singapore bank transaction-alert emails, asks one question per transaction, and reports monthly.

**Status: building.** Strategy and SPIKE-01's format/extraction evidence are done; coverage (the actual go/no-go number) is still being measured in the background while this builds in parallel — Nat's call, recorded in `docs/STRATEGY.md` §3.

---

## Read in this order

| Document | What it is |
|---|---|
| [`docs/STRATEGY.md`](docs/STRATEGY.md) | Locked decisions, phasing, what was cut and why, live risks |
| [`docs/SPIKE-01-email-parsing.md`](docs/SPIKE-01-email-parsing.md) | The go/no-go validation protocol — coverage still running |
| [`docs/SPIKE-01-RESULTS.md`](docs/SPIKE-01-RESULTS.md) | Real sample evidence and the decisions it forced (FX handling, reversal handling, unrecognised-email triage) |
| [`docs/PRD.md`](docs/PRD.md) | What it does, scoped to one user, FR-1 through FR-22 |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Design and schema this code actually implements |
| [`ideation-archive/`](ideation-archive/) | The original DeepSeek ideation dump, preserved |

## Scope — read this before suggesting anything

**Personal tool. One user. No scale intent.** No growth targets, no distribution, no monetisation, no second user — ever. Don't propose marketing, multi-tenancy, or a public launch.

## Setup

### 1. Prerequisites

- A Telegram bot token from [@BotFather](https://t.me/BotFather) and your numeric chat ID from [@userinfobot](https://t.me/userinfobot)
- A [Neon](https://neon.tech) Postgres project (free tier) and its connection string
- A [Vercel](https://vercel.com) account connected to this GitHub repo
- The dedicated Gmail inbox and auto-forward filter from `docs/SPIKE-01-email-parsing.md` §0a — should already be live

### 2. Generate three secrets

Any long random string works — e.g. `openssl rand -hex 32`, once each for:

- `TELEGRAM_WEBHOOK_SECRET`
- `INGEST_SECRET`
- `CRON_SECRET`

### 3. Deploy to Vercel

1. Import this repo into Vercel
2. Add environment variables (Project Settings → Environment Variables), matching `.env.example`:
   `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET`, `INGEST_SECRET`, `CRON_SECRET`
3. Deploy. `vercel.json` already declares the daily cron — no extra setup needed there

### 4. Run the database migration once

From your own machine (not a restricted sandbox — plain Postgres wire protocol needs open egress):

```bash
DATABASE_URL="<your Neon connection string>" npm run db:migrate
```

If that fails with a networking error, `scripts/migrate-http.mjs` applies the same migration over plain HTTPS instead — this is what verified the schema against the real database during development, in an environment where raw Postgres access was blocked:

```bash
DATABASE_URL="<your Neon connection string>" node scripts/migrate-http.mjs
```

### 5. Register the Telegram webhook

Once deployed, tell Telegram where to send updates (replace both placeholders):

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -d "url=https://<your-vercel-domain>/api/telegram" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

### 6. Set up the Apps Script side

`apps-script/forward-to-ingest.gs` has full setup instructions in its header comment. Summary: paste it into a new Apps Script project **inside the dedicated Gmail account**, set `INGEST_URL` (your `/api/ingest` endpoint) and `INGEST_SECRET` as Script Properties, then add a 5-minute time-driven trigger on `pollInbox`.

### 7. Test end to end

Forward yourself a real bank alert (or wait for a real one). Within ~5 minutes it should reach your dedicated inbox, Apps Script picks it up, `/api/ingest` parses it, and a Telegram message arrives.

## The one thing that still decides whether this should keep existing

Whether Nat's banks actually send a parseable email for **every** transaction — coverage, not just parseability. Building proceeded ahead of that number per `docs/STRATEGY.md` §3; a genuine NO-GO there (see `docs/SPIKE-01-email-parsing.md` §5) is still the one outcome that would undo this decision.

## About `ideation-archive/`

Thirty-one files from a DeepSeek session on 2026-08-16. Renamed for legibility; content unchanged, nothing deleted. Treat it as raw material, not specification — where it contradicts `docs/` or the actual code, those win.

## Stack

Next.js App Router on Vercel · Neon Postgres (HTTP driver) · Drizzle ORM · grammY · Google Apps Script for mail forwarding · Frankfurter for FX. $0/month.

---

Vault context: `Efforts/Ongoing/TallyMyMoney/` in ideaverse.
