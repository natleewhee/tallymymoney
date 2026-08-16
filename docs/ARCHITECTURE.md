# TallyMyMoney — Target Architecture

**Status:** proposed, pending SPIKE-01 · Supersedes everything in `ideation-archive/`

---

## 1. Shape

```
   Bank (DBS / UOB / Citibank / Trust / Amex)
        │  transaction alert email
        ▼
   Nat's Gmail ──── filter: forward + archive ────┐
                                                   │
                                                   ▼
                                    tally@… (dedicated Gmail)
                                                   │
                              Apps Script, 5-min time trigger
                                                   │  HTTPS POST + shared secret
                                                   ▼
        ┌──────────────────────────────────────────────────────┐
        │  Vercel — one Next.js project                        │
        │                                                      │
        │  /api/ingest      parse → dedupe → persist → notify  │
        │  /api/telegram    webhook: button taps, commands     │
        │  /api/cron/daily  no-op except on the 1st            │
        └───────────────┬──────────────────────┬───────────────┘
                        │                      │
                        ▼                      ▼
                Neon Postgres            Telegram Bot API
                                                │
                                                ▼
                                          Nat's phone
```

One deployable. Three routes. No worker, no queue, no long-running process.

## 2. Why this rather than the dump's design

| Dump | Here | Why |
|---|---|---|
| IMAP poll Nat's real inbox | Gmail filter forwards to a dedicated inbox | The bot never touches mail that matters. Worst-case blast radius is a mailbox that exists only for this |
| `mark as read` = deduplication | `Message-ID` unique constraint | Mutating mail state as a correctness mechanism fails the moment anything is re-scanned or re-delivered |
| Python worker looping `sleep(300)` | Apps Script time trigger | Vercel has no long-running worker, and Hobby cron is daily. Apps Script gives a free 5-minute trigger and lives next to the mail it reads |
| Gmail app password in env | No email credentials anywhere | Apps Script runs *as* the dedicated account. There is nothing to store and nothing to leak |
| 4 Render services, ~$14–21/mo | 1 Vercel project, $0 | Personal load. The free tiers are oversized for it |
| FastAPI / SQLAlchemy / Alembic | Next.js / Drizzle | Matches the stack InsureCheck and DriveReady already ship on |

The IMAP path stays viable as a fallback if Apps Script proves awkward — a GitHub Actions cron hitting `/api/ingest` costs nothing either. Recorded so the option isn't lost.

## 3. Components

### Gmail filter (Nat's account)
`from:(dbs.com.sg OR uobgroup.com OR citibank.com.sg OR trustbank.sg OR americanexpress.com)` → forward to the dedicated address, skip inbox, apply label. **These domains are a starting guess, not a verified fact** — SPIKE-01 Step 1 confirms the real sending addresses from actual alert mail before the filter is finalised; see §3 of `STRATEGY.md` on why invented specifics are the risk here. Forwarding addresses need one-time verification.

### Apps Script (dedicated account)
Every 5 minutes: read unprocessed threads, POST raw subject + body + `Message-ID` to `/api/ingest` with a shared secret header, then label as sent. Deliberately dumb — **no parsing here.** Parsing belongs in the app where it is version-controlled and testable.

### `/api/ingest`
Verify secret → identify bank by sender → parse → insert with `Message-ID` idempotency → send Telegram notification. **A parse that yields nothing still sends a Telegram message** ("couldn't read this one"). Silent failure is the failure mode that hurts — see R3.

### `/api/telegram`
Webhook for button callbacks and slash commands. Sub-second work only.

### `/api/cron/daily`
Vercel Hobby allows one daily cron. It exits immediately unless it is the 1st, when it builds and sends the monthly report. Cheaper than fighting the free-tier scheduler.

## 4. Data model

Trimmed hard from `ideation-archive/schema-full.sql`. Single user, so no `users` table and no ownership columns anywhere.

```sql
CREATE TABLE transactions (
  id                  SERIAL PRIMARY KEY,
  email_message_id    TEXT UNIQUE NOT NULL,   -- idempotency, enforced by the DB
  amount_cents        BIGINT NOT NULL,        -- integers, never floats
  currency            CHAR(3) NOT NULL DEFAULT 'SGD',
  direction           TEXT NOT NULL CHECK (direction IN ('debit','credit')),
  merchant_raw        TEXT,                   -- exactly as the bank wrote it
  merchant_normalised TEXT,                   -- what drives memory and reports
  description         TEXT,
  category            TEXT,
  split               TEXT CHECK (split IN ('solo','joint','ignored')),
  bank                TEXT NOT NULL,
  account_last4       TEXT,
  occurred_at         TIMESTAMPTZ NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','tagged','ignored','unparsed')),
  raw_email           TEXT,                   -- kept: the only way to fix a bad parse
  telegram_message_id BIGINT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tagged_at           TIMESTAMPTZ
);

-- merchant memory: the feature that keeps tagging to one tap
CREATE TABLE merchant_rules (
  merchant_normalised TEXT PRIMARY KEY,
  category            TEXT NOT NULL,
  default_split       TEXT,
  hit_count           INT NOT NULL DEFAULT 1,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tx_occurred ON transactions (occurred_at DESC);
CREATE INDEX idx_tx_status   ON transactions (status) WHERE status = 'pending';
```

Four deliberate departures from the dump:

- **`amount_cents BIGINT`, not `DECIMAL`.** Integer cents removes a whole class of rounding argument, and nothing here needs fractional cents.
- **`raw_email` retained.** When a parser turns out to be wrong three weeks in, this is the difference between reprocessing the history and losing it.
- **`merchant_raw` and `merchant_normalised` kept separate.** The bank's string is evidence; the normalised one is a derived guess and will need re-deriving.
- **`status = 'unparsed'`** is a real state. An email that arrived and could not be read is data, not an absence.

Dropped from the dump: `users`, `email_credentials_encrypted`, `archived_to_sheets`, `monthly_summaries` (derivable on demand at this volume), `matched_transaction_id` (deferred with income matching to Phase 5).

## 5. Stack choices

| Layer | Choice | Reason |
|---|---|---|
| App | Next.js App Router on Vercel | Same as InsureCheck and DriveReady. Zero new ground |
| DB | **Neon** Postgres, free tier | Autosuspends when idle and resumes on its own. *Supabase free pauses a project after ~7 days of inactivity and needs manual resuming* — a genuine hazard for a bot that goes quiet. Neon is the safer default here |
| ORM | Drizzle | TS-native, light cold start, SQL stays readable |
| Telegram | **grammY** | Built for serverless webhooks; `telegraf` assumes a long-lived process |
| Scheduling | Apps Script (5 min) + Vercel daily cron | Works inside free-tier limits rather than against them |
| Secrets | Vercel env vars | One user, no credential storage problem to solve |

## 6. Security

Small surface, and it should stay small.

- `/api/ingest` requires a shared secret header; reject anything else without a hint as to why
- `/api/telegram` verifies Telegram's secret token header, and ignores any `chat_id` that isn't Nat's
- No third-party credentials stored — Apps Script's authority is its own account's
- `raw_email` holds financial detail. Neon free tier encrypts at rest; access is the Vercel/Neon accounts. Acceptable at personal scale, and would not be if D1 ever changed

## 7. Open

- Dedicated Gmail vs a Google Workspace alias — plain Gmail is simpler and probably right
- Whether Cloudflare Email Routing → Worker is worth swapping in later for true push (needs a custom domain; removes the 5-minute lag)
- Timezone handling: `TIMESTAMPTZ` stored UTC, rendered Asia/Singapore. Month boundaries in reports must use SGT or every month-end is subtly wrong
