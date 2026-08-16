# TallyMyMoney — Strategy

**Status:** awaiting approval · **Date:** 2026-08-16 · **Phase:** 0 (strategy, nothing built)

---

## 1. What this is

A Telegram bot that watches Singapore bank transaction-alert emails, pushes each one to Nat for a one-tap Solo/Joint + category tag, and reports monthly. Single user. Personal utility.

It is **not** a product, and this document treats it as a private tool throughout.

## 2. Decisions locked

These four came from a direct decision session on 2026-08-16 and everything downstream follows from them. Anything in `ideation-archive/` that contradicts them is superseded.

| # | Decision | Chosen | What it kills |
|---|---|---|---|
| D1 | Scale intent | **Personal tool only** — Nat, plus partner as a reporting dimension | Multi-user tables, stored third-party credentials, Gmail OAuth restricted-scope verification, PDPA exposure, any growth/monetisation work |
| D2 | Capture route | **Bank alert emails, validated first**, delivered via **forward to a dedicated address** | IMAP polling of Nat's real inbox; the destructive "mark as read" dedup hack |
| D3 | Stack | **TypeScript / Next.js / Vercel** | Python, FastAPI, Render's three-service topology, ~$14–21/mo hosting |
| D4 | Joint expenses | **Partner does not touch the bot** — Nat tags, "joint" is a reporting flag on his own ledger | Second Telegram user, settlement ledger, who-owes-whom logic, direct Splitwise competition |

### Consequence worth stating plainly

D1 means TallyMyMoney is **not** the "ship something publicly" goal in `Home.md`. That goal still belongs to the Football Idle RPG or a Nat Does The Math tool. Recorded as fact, not as an argument to revisit it — the no-scale constraint is what makes this cheap and fast.

## 3. The one thing that decides whether this project exists

> **Do Nat's banks actually send a parseable email for every transaction?**

Everything else — the bot, the schema, the reports — is ordinary work. This is not. If DBS/OCBC/UOB only alert above a threshold, only for card-not-present, or push to their app instead of email, the product has no input and no amount of good engineering fixes it.

The ideation dump contains regex patterns for DBS, OCBC and Citibank. **Those patterns were invented by a language model, not observed from real email.** They are worth exactly nothing as evidence.

So the build order is not "database, then backend, then bot." It is:

**Prove the input exists → build the pipe → build the interface.**

`SPIKE-01-email-parsing.md` is the first and only task until it returns a verdict.

## 4. Architecture, in one line

```
Bank → alert email → Gmail filter forwards → dedicated Gmail inbox
     → Apps Script trigger (5 min, free) → POST → Vercel API route
     → parse → Neon Postgres → Telegram message with buttons
```

The important move: **no IMAP, no stored email credentials, and nothing polls Nat's real inbox.** The dedicated inbox is the bot's own; if the parser goes wrong it can only damage a mailbox that exists solely for this. Full detail in `ARCHITECTURE.md`.

## 5. Phasing

| Phase | What | Gate to pass | Rough effort |
|---|---|---|---|
| **0** | Strategy (this document) | Nat approves | done |
| **1** | **SPIKE-01** — enable bank alerts, collect real email, measure coverage and extraction accuracy | Go/no-go thresholds in the spike doc | ~1 day work, ~2 weeks wall-clock |
| **2** | Capture pipeline — forwarding, Apps Script, endpoint, Postgres | One real transaction lands in the DB, unattended | 1–2 sessions |
| **3** | Telegram loop — notification, buttons, category + solo/joint, merchant memory | Two weeks of live use with <10% untagged | 2–3 sessions |
| **4** | Reports — `/today`, `/week`, `/month`, monthly auto-send | A month-end report Nat actually reads | 1 session |
| **5** | Optional — income matching, CSV export | only if wanted after Phase 4 | — |

Phase 1's wall-clock is longer than its work because **the evidence may not exist yet.** If alert emails were never switched on in ibanking, there is no history to sample and the spike has to collect forward for two weeks. Switching alerts on is the first action, today.

## 6. Cut from the ideation dump, and why

| Cut | Reason |
|---|---|
| `users` table, `email_credentials_encrypted` | D1. One user. Credentials live in Vercel env vars. Storing an encrypted password column for a single-user app is pure liability with zero benefit |
| Google Sheets archive | Redundant against Postgres. Costs a service account, an API dependency and a sync-failure mode to buy a spreadsheet Nat can already get from a CSV export |
| Sarah (28, Marketing Manager) and John (22, student) personas | Invented US personas on a Singapore-bank product. No one is served by fiction |
| "10,000 transactions/month, 1,000 emails/day, 99.9% uptime SLA" | Nat generates perhaps 50–150 transactions a month. These NFRs were cargo-culted |
| Render web + worker + cron + Postgres (4 services) | D3. Collapses to one Vercel project plus a managed Postgres |
| IMAP polling with `mark as read` as dedup | D2. Mutates real mail, and loses idempotency the moment a re-scan happens. Replaced by `Message-ID` uniqueness |
| Income matching via "show last 5 expenses" | Breaks past a few days, can't handle one payment settling three expenses or a partial repayment. Deferred to Phase 5 and redesigned if it survives |
| The Solo/Joint-then-category flow contradiction | The mockups ask Solo/Joint first; the state machine asks category first. Resolved in the PRD: **category first, then Solo/Joint**, with merchant memory skipping step one after the first sighting |

## 7. Live risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | **Alert coverage gap** — banks don't email every transaction | **Kill** | SPIKE-01 measures it before anything is built. Explicit go/no-go threshold |
| R2 | **No manual-entry fallback was selected.** Cash spending, un-alerted transactions, and anything below an alert threshold are invisible — and the monthly report will silently understate every month | High | *Recommend adding a plain-text quick-entry command in Phase 3* (`"12.50 kopi"` → parsed). Cheap to build, and it is the only defence against R1 turning into permanently wrong numbers. Flagged for Nat's call |
| R3 | **Parser drift** — a bank changes its email template and extraction silently returns nothing | High | Any forwarded mail that yields no transaction fires a Telegram "couldn't parse this" alert. Never fail silently |
| R4 | **Duplicates** — a re-forwarded or re-delivered email double-counts | Medium | `Message-ID` unique constraint at the DB level, not in application logic |
| R5 | **Free-tier behaviour** — Vercel Hobby cron runs daily, not every 5 minutes | Medium | Scheduling lives in Apps Script, not Vercel Cron. The daily Vercel cron only no-ops until the 1st of the month. Designed around, not fought |
| R6 | **Abandonment** — the tagging loop becomes a chore and the bot gets muted | Medium | Merchant memory from Phase 3: a merchant seen before auto-fills its category, so the steady-state interaction is one tap, not three |

## 8. Cost

| Item | Plan | Cost |
|---|---|---|
| Vercel | Hobby | $0 |
| Neon Postgres | Free (0.5 GB) | $0 |
| Google Apps Script | Free quota | $0 |
| Telegram Bot API | — | $0 |
| Dedicated Gmail account | Free | $0 |
| **Total** | | **$0/month** |

Against the dump's ~$14–21/month on Render. At personal scale the free tiers are not a compromise — they are oversized for the load.

## 9. What approval unblocks

Approving this document authorises **Phase 1 only** — switching on bank alerts and running SPIKE-01. No application code gets written until the spike returns a verdict, and the verdict may be "don't build this."

That is a real possible outcome and it would be a good one: a week spent learning the input doesn't exist beats three months building a bot with nothing to parse.

## 10. Open questions for Nat

1. **Which banks and cards?** The dump names DBS, OCBC, UOB, Citibank. What does Nat actually hold — including Trust, GXS, Amex, Revolut, or anything else?
2. **R2 — add manual quick-entry?** Recommend yes, in Phase 3.
3. **Categories** — is the dump's eight-category list right, or does it need Singapore-specific splits (transport → Grab/public/COE/petrol, for instance)?
4. **Does the partner ever need to *see* anything?** D4 says they don't touch the bot; a read-only monthly summary forwarded to them is a different and much cheaper question.

---

Related: `PRD.md` · `ARCHITECTURE.md` · `SPIKE-01-email-parsing.md` · `ideation-archive/`
