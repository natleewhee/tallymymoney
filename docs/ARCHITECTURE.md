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
`from:(dbs.com OR uobgroup.com OR citibank.com.sg OR trustbank.sg OR americanexpress.com)` → forward to the dedicated address, skip inbox, apply label. **DBS, UOB and Trust are confirmed against real forwarded samples** (see `SPIKE-01-RESULTS.md`) — `dbs.com` replaces an earlier guess of `dbs.com.sg`, which turned out wrong, exactly the failure mode described in §3 of `STRATEGY.md`. Citibank and Amex domains are still unconfirmed guesses pending samples. Forwarding addresses need one-time verification.

### Apps Script (dedicated account)
Every 5 minutes: read unprocessed threads, POST raw subject + body + `Message-ID` to `/api/ingest` with a shared secret header, then label as sent. Deliberately dumb — **no parsing here.** Parsing belongs in the app where it is version-controlled and testable.

### `/api/ingest`
Verify secret → identify bank by sender → parse → insert with `Message-ID` idempotency → send Telegram notification. **A parse that yields nothing still sends a Telegram message** ("couldn't read this one"). Silent failure is the failure mode that hurts — see R3.

**Unrecognised-pattern triage (FR-4/FR-20).** Before parsing, look up `(sender, subject)` in `sender_rules`. A hit with `action = 'ignore'` archives the email — no Telegram message, no row anywhere. A hit with `action = 'needs_parser'` inserts into `unclassified_emails` and stops there — no repeat alert for a pattern already queued. No hit at all means this `(sender, subject)` pair has never been seen: insert into `unclassified_emails` with `status = 'pending_review'` and send a one-time Telegram triage message with two buttons, **Ignore this type** and **Needs parser**, either of which writes the `sender_rules` row so the decision is made once per pattern, not once per email. Confirmed viable by real DBS/UOB/Trust/Citibank samples in `SPIKE-01-RESULTS.md`, where distinct transaction types reliably carry distinct, stable subject lines from the same sending address — `(sender, subject)` is a real fingerprint, not a guess. (One DBS subject, `"iBanking Alerts"`, may turn out not to be unique — flagged there, not yet resolved.)

**Foreign-currency conversion (FR-2/FR-22).** When `currency != 'SGD'`, ingest calls a spot-rate lookup — **Frankfurter** (ECB reference rates, free, no API key, no signup) is the default pick, matching the $0/month constraint — and stores the result as `sgd_amount_cents` / `fx_rate` with `fx_source = 'spot_estimate'`. The Telegram notification (FR-6) marks these visibly, e.g. "≈ SGD 566.90 (estimated)". If the lookup fails (API down, unsupported currency), fall back to the most recent cached rate for that currency pair rather than blocking the transaction — a stale estimate beats no transaction at all, and it's getting corrected anyway. Nat corrects it later via FR-22 once he has the real posted amount; card-network FX carries a markup (typically 1–3%) that a spot/interbank rate will never match exactly, so a difference between the estimate and the statement is expected, not a bug.

### `/api/telegram`
Webhook for button callbacks and slash commands. Sub-second work only.

### `/api/cron/daily`
Vercel Hobby allows one daily cron. It exits immediately unless it is the 1st, when it builds and sends the monthly report. Cheaper than fighting the free-tier scheduler.

## 4. Data model

Trimmed hard from `ideation-archive/schema-full.sql`. Single user, so no `users` table and no ownership columns anywhere.

```sql
CREATE TABLE transactions (
  id                    SERIAL PRIMARY KEY,
  email_message_id      TEXT UNIQUE NOT NULL,   -- idempotency, enforced by the DB
  amount_cents          BIGINT NOT NULL,        -- integers, never floats. Original amount,
                                                 -- original currency. Every row here parsed
                                                 -- successfully — see unclassified_emails
                                                 -- below for anything that didn't
  currency              CHAR(3) NOT NULL DEFAULT 'SGD',
  sgd_amount_cents       BIGINT NOT NULL,        -- FR-2/FR-22: what every report actually
                                                 -- sums. Equal to amount_cents when
                                                 -- currency = 'SGD'; for anything else, a
                                                 -- spot-rate conversion at ingest time
  fx_source              TEXT NOT NULL DEFAULT 'na'
                          CHECK (fx_source IN ('na','spot_estimate','confirmed')),
                                                 -- 'na' for SGD rows. 'spot_estimate' until
                                                 -- Nat corrects it via FR-22, then 'confirmed'
  fx_rate                 NUMERIC,               -- rate actually used, kept for audit —
                                                 -- card-network FX includes a markup a spot
                                                 -- rate won't capture, which is the whole
                                                 -- reason FR-22 exists
  direction              TEXT NOT NULL CHECK (direction IN ('debit','credit')),
  merchant_raw          TEXT,                   -- exactly as the bank wrote it
  merchant_normalised   TEXT,                   -- what drives memory and reports
  description           TEXT,
  category               TEXT,
  split                  TEXT CHECK (split IN ('solo','joint','ignored')),
  bank                   TEXT NOT NULL,
  account_identifier     TEXT,                  -- usually a last-4; a bank that never gives
                                                 -- one (Trust) gets the card/product name
                                                 -- instead, e.g. "Freedom" — confirmed
                                                 -- sufficient by Nat for a single-card setup
  occurred_at            TIMESTAMPTZ NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','tagged','ignored')),
  reduces_transaction_id INT REFERENCES transactions(id),  -- FR-21: set when this row is a
                                                 -- manually-tagged refund/reversal against an
                                                 -- earlier row. Reporting nets it off the
                                                 -- referenced transaction and excludes this
                                                 -- row from independent totals
  raw_email              TEXT,                  -- kept: the only way to fix a bad parse
  telegram_message_id    BIGINT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tagged_at              TIMESTAMPTZ
);

-- merchant memory: the feature that keeps tagging to one tap
CREATE TABLE merchant_rules (
  merchant_normalised TEXT PRIMARY KEY,
  category            TEXT NOT NULL,
  default_split       TEXT,
  hit_count           INT NOT NULL DEFAULT 1,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- FR-4/FR-20: anything that didn't become a transaction — an unrecognised
-- (sender, subject) pair, or a previously-working pattern that returned nothing this time
CREATE TABLE unclassified_emails (
  id                SERIAL PRIMARY KEY,
  email_message_id  TEXT UNIQUE NOT NULL,
  sender            TEXT NOT NULL,
  subject           TEXT,
  raw_email         TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending_review'
                      CHECK (status IN ('pending_review','ignored','needs_parser')),
  received_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- FR-20a/FR-20b: Nat's one-time classification of a (sender, subject) pattern,
-- applied to every future email matching it
CREATE TABLE sender_rules (
  sender      TEXT NOT NULL,
  subject     TEXT NOT NULL,
  action      TEXT NOT NULL CHECK (action IN ('ignore', 'needs_parser')),
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (sender, subject)
);

CREATE INDEX idx_tx_occurred    ON transactions (occurred_at DESC);
CREATE INDEX idx_tx_status      ON transactions (status) WHERE status = 'pending';
CREATE INDEX idx_tx_fx_estimate ON transactions (id) WHERE fx_source = 'spot_estimate';
CREATE INDEX idx_unclassified   ON unclassified_emails (status) WHERE status != 'ignored';
```

Deliberate departures from the dump:

- **`amount_cents BIGINT`, not `DECIMAL`.** Integer cents removes a whole class of rounding argument, and nothing here needs fractional cents.
- **`raw_email` retained.** When a parser turns out to be wrong three weeks in, this is the difference between reprocessing the history and losing it.
- **`merchant_raw` and `merchant_normalised` kept separate.** The bank's string is evidence; the normalised one is a derived guess and will need re-deriving.
- **A row only ever reaches `transactions` if it parsed successfully.** An earlier version of this schema put `'unparsed'` in `transactions.status`, which quietly contradicted `amount_cents NOT NULL` — there is no real amount to store for an email that failed to parse. Fixed by moving that state out entirely: `unclassified_emails` holds anything that isn't a clean transaction — an unrecognised `(sender, subject)` pair or a previously-working pattern that returned nothing — and `sender_rules` holds Nat's one-time Ignore/Needs-parser decision per pattern (FR-4/FR-20). An email that arrived and could not be turned into a transaction is still data; it just isn't a `transactions` row.
- **`account_identifier`, not `account_last4`.** Trust's alerts never include a last-4, only the card product name. Confirmed by Nat as sufficient for a single-card setup — the column stores whichever the bank actually gives.
- **`reduces_transaction_id` (FR-21), narrower than the dropped `matched_transaction_id`.** A manual "this refund/reversal reduces that earlier transaction" link, picked from a short recent list — not full income matching. Added directly from a real Trust partial-reversal pair found in the SPIKE-01 samples; confirmed by Nat 2026-08-16 as the whole solution wanted here, deliberately simpler than automatic detection.
- **`sgd_amount_cents` / `fx_source` / `fx_rate` (FR-2/FR-22).** The dump assumed SGD-only and never faced this. A real Citibank sample forced the question — a foreign-currency alert with no SGD figure at all — and Nat's answer was spot-rate now, corrected later, not "wait for the statement" or "reject foreign currency." `amount_cents` stays the original-currency amount; `sgd_amount_cents` is what every report actually sums.

Dropped from the dump: `users`, `email_credentials_encrypted`, `archived_to_sheets`, `monthly_summaries` (derivable on demand at this volume). `matched_transaction_id` — the *general* income-matching case (one payment settling several expenses, or anything outside `reduces_transaction_id`'s short recent list) — stays deferred to Phase 5 as FR-17.

## 5. Stack choices

| Layer | Choice | Reason |
|---|---|---|
| App | Next.js App Router on Vercel | Same as InsureCheck and DriveReady. Zero new ground |
| DB | **Neon** Postgres, free tier | Autosuspends when idle and resumes on its own. *Supabase free pauses a project after ~7 days of inactivity and needs manual resuming* — a genuine hazard for a bot that goes quiet. Neon is the safer default here |
| ORM | Drizzle | TS-native, light cold start, SQL stays readable |
| Telegram | **grammY** | Built for serverless webhooks; `telegraf` assumes a long-lived process |
| Scheduling | Apps Script (5 min) + Vercel daily cron | Works inside free-tier limits rather than against them |
| Secrets | Vercel env vars | One user, no credential storage problem to solve |
| FX rates | **Frankfurter** (ECB reference rates) | Free, no API key, no signup — matches the $0/month constraint. New dependency as of FR-2/FR-22; only called for the (expected to be rare) non-SGD transaction |

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
