# TallyMyMoney — Handover

**Date:** 2026-09-01 · **Status:** live, in daily personal use · **Author:** written by Claude at the end of a work session, for whoever (Nat, or a future Claude session) picks this up next

---

## Why this document exists

`PRD.md`, `ARCHITECTURE.md`, and `STRATEGY.md` are all dated 2026-08-16 and marked "proposed, pending SPIKE-01" — they're the pre-build design record, and they're still accurate about *intent* and *why* decisions were made. But 27 PRs have shipped since, and none of the three has been updated to say what actually exists today. `README.md` still says "Status: building."

This document is the current-state entry point: what's actually running, what changed from the original design, what's still open. It doesn't replace the other docs — it points at them for the reasoning behind each decision, and only restates facts here where they've drifted from what was originally written down.

**Read order for someone new:** this document first (current state), then `STRATEGY.md` (why it exists, what was decided and cut), then `ARCHITECTURE.md` (design detail), then `PRD.md` (original requirements — see the traceability table below for what's since changed), then `LESSONS.md` (debugging incidents worth not repeating).

## What this is, in one paragraph

A Telegram bot, single user (Nat), that reads Singapore bank transaction-alert emails (DBS, UOB, Trust, Citibank), asks one tap per transaction (category + solo/joint), and reports on demand or automatically. No web UI, no other users, ever. Runs on Vercel + Neon Postgres + Google Apps Script, $0/month. Full rationale in `STRATEGY.md`.

## Current status

**Live and in daily use.** Real bank emails are being forwarded, parsed, and tagged; `/today`, `/week`, `/month`, `/partner`, `/export` are all in regular use; the 1st-of-month automatic report has been sending since it shipped. This is well past the "building" label `README.md` still carries.

The one thing `STRATEGY.md` §3 named as the project's actual bet — *do the banks send a parseable email for every transaction* — has not been formally re-measured against SPIKE-01's go/no-go threshold since building proceeded ahead of it (per that document's own "Update, 2026-08-16" note). In practice, coverage has been good enough that this hasn't come up as a live problem, but no one has gone back and written the actual number down. See **Open items** below.

## Requirement traceability

Every FR from `PRD.md` §5, with what's actually true today. "Done" means shipped and in use; anything else is called out.

| ID | Requirement | Status | Notes |
|---|---|---|---|
| FR-1 | Emails reach `/api/ingest` within 5 minutes | **Done** | |
| FR-2 | Extract fields; foreign-currency spot-converts to SGD | **Done** | Extended by defect 11: when no rate is available at all, stored as a `placeholder` and excluded from totals rather than a wrong 1:1 conversion |
| FR-3 | No duplicate transactions from the same email | **Done** | `email_message_id` unique constraint |
| FR-4 | New/broken pattern triggers one-time triage | **Done** | |
| FR-20/20a/20b | Ignore / Needs-parser triage actions, with Gmail labelling | **Done** | The needs-parser → Gmail-label → forward-back loop (PR #16) and the label removal once resolved (`gmail_label_removals` table) both shipped |
| FR-5 | Ignored patterns stay silently discarded | **Done** | Superseded by FR-20a, as the PRD itself notes |
| FR-6 | New-transaction message, SGT time | **Done** | |
| FR-7/FR-8 | Known-merchant one-tap confirm; unknown-merchant category-first flow | **Done** | |
| FR-9 | Plain-language tag confirmation; merchant memory | **Done** | `normaliseMerchant` hardened since, `/merchants` command added to inspect the memory table |
| FR-10 | Ignore action | **Done** | |
| FR-11 | Reply to amend description | **Done** | |
| FR-12 | `/pending` sweep | **Done, enhanced** | Now lists the actual stuck untagged transactions and needs-parser emails (sender/subject/date), not just counts, with inline tagging buttons — the original count-only version left Nat unable to tell *which* email was outstanding |
| FR-21 | Reduce action (refund/reversal net-off) | **Done** | Candidate list bounded and over-reduction rejected (defect 6) |
| FR-22 | Amend SGD amount by replying with a bare number | **Done** | |
| FR-13 | `/today` `/week` `/month` | **Done** | |
| FR-14 | Automatic monthly report, 1st of the month | **Done, substantially extended** | Originally a bare total; now includes a full-month-vs-full-month comparison, a settle-up section with a working button, and a `.md` file attachment with the complete itemised transaction list (PR #26) |
| FR-15 | Every report states its own incompleteness | **Done** | |
| FR-16 | `/export` CSV | **Done** | Was scoped P2 ("later") in the PRD; shipped anyway. Aligned to match report scope with correct CSV quoting (item 17) |
| FR-17 | General income-matching (one payment settling several expenses) | **Not built — still deferred to Phase 5** | Unchanged from the PRD. `reduces_transaction_id` (FR-21) covers the narrow one-transaction case; this is the general case and still needs its own design if it's ever wanted |
| FR-18 | Manual quick-entry (`/add <amount> <merchant>`) | **Done** | |
| FR-19 | `/partner` on-demand summary + settle-up | **Done** | Settle-up is a real computed figure backed by a `settlements` table, not just a summary — `/partner`'s "Mark settled" button and the automatic monthly report's equivalent (encoded to the specific reported month) both write to it |

**Net: every P0/P1 requirement from the original PRD is done.** The only gap against the PRD as written is FR-17, which was always P2/Phase-5 and explicitly deferred.

## Shipped beyond the PRD

None of this was in the original spec — it came from real use surfacing gaps, an adversarial code audit, and real forwarded bank emails exposing parser gaps one at a time.

**New commands:** `/help`, `/rules` (list/clear sender ignore or needs-parser rules), `/undo` (revert the last tag and its merchant-memory effect), `/merchants` (inspect merchant memory), `/estimates` (list unconfirmed FX estimates), `/whoami` (diagnostic).

**Operational resilience:**
- Daily heartbeat — alerts if the whole pipeline has gone quiet for 36+ hours (something's stuck, not just a quiet spending day)
- Weekly Monday month-to-date nudge, so mid-month feedback exists before the 1st
- `resendUnnotified` / `retryUnparsed` recovery paths for transactions that saved but never got a Telegram alert, and emails that failed to parse but would parse now — the latter made resilient to a partially-completed prior recovery run (item 19)
- Every callback query gets answered, even on an error path (defect 7) — an un-answered tap just spins in the Telegram client with no feedback otherwise

**Bank parser coverage**, all confirmed against real forwarded samples, not invented regex:

| Bank | Shapes recognised |
|---|---|
| DBS | Card spend, PayNow received, FAST transfer received, foreign-currency card table shape |
| UOB | Card spend, PayNow received, transaction reversal, card refund (posted-to-statement, distinct from a reversal) |
| Trust | Overseas card spend, declined-transaction notice, overseas refund |
| Citibank | Card spend |
| Amex | **Not implemented** — no sample has ever been seen from this sender. See Open items |

**Correctness fixes worth knowing about**, since they shaped conventions still in force (see "Conventions for continuing work" below): credits weren't counted in totals at all (defect 4); UOB card-spend transactions defaulted to midnight SGT instead of a real time; DBS transactions in December got filed a year early; the `/rules` clear button was keyed by array position instead of a stable identity and could delete the wrong rule; category buttons encoded an array index instead of the category name, so a reordering could silently retag old messages; and the most significant one — `bot.catch`'s error handler wasn't `async` and its `await` was dropped, so error-path Telegram messages raced the serverless function being frozen and were silently lost (found by reading grammY's own source, same style of investigation as the incident already written up in `LESSONS.md`, which does **not** yet have this one added — see Open items).

## Current architecture snapshot

Same shape as `ARCHITECTURE.md` §1 (Gmail → Apps Script → `/api/ingest` / `/api/telegram` / `/api/cron/daily` → Neon + Telegram) — that hasn't changed. What has changed is the schema and the cron route's actual responsibilities.

**`lib/schema.ts` now has three tables beyond what `ARCHITECTURE.md` §4 documents:**

- `tag_undo_log` — snapshots the prior state of a transaction row *and* the merchant rule it touched, before every tag, so `/undo` can revert both (tagging writes in two places; undoing has to restore both or it half-works)
- `gmail_label_removals` — a work queue for taking the 🔴 needs-parser label back off a Gmail thread once it's resolved, since the row that would otherwise carry that instruction gets deleted the moment a reparse succeeds
- `settlements` — one row per calendar month Nat's confirmed as settled with his partner, keyed by full month bounds; backs both `/partner`'s and the automatic monthly report's "Mark settled" button

Plus two columns added to existing tables: `unclassified_emails.body_format` (records whether a stuck email's raw content was text or HTML, rather than re-guessing later) and the `fx_source` check constraint gaining `'placeholder'` (defect 11 — no real rate available, excluded from totals rather than summed at a wrong 1:1).

**`/api/cron/daily` is now a triple-duty route**, not the single "no-op except on the 1st" `ARCHITECTURE.md` §3 describes:
1. Every day: pipeline heartbeat
2. Mondays: month-to-date nudge
3. The 1st: the full monthly report (text + settle-up + markdown attachment)

## Command reference

Current `/help` output — this is the authoritative list, reproduced here so it doesn't have to be looked up separately:

```
/today — Today's spending
/week — Last 7 days
/month — This month, by category
/pending — Transactions and email patterns awaiting action
/add <amount> <merchant> — Log a cash spend, e.g. /add 12.50 Kopitiam
/partner — Shareable summary + settle-up figure for this month
/export — CSV export for this month
/rules — List/clear ignore or needs-parser rules
/undo — Revert the last tag (and its merchant rule)
/estimates — List transactions with an unconfirmed FX estimate
/merchants — Merchant memory, sorted by how often each rule fires

On a transaction message:
- Reply with a bare number to confirm an unconfirmed FX amount
- Reply with any other text to set that transaction's description
- ↩️ Reduce nets a refund/reversal off an earlier purchase
```

## Open items

Things that are genuinely unresolved, not just "not built yet by design" (FR-17 is the latter and isn't repeated here):

1. **Coverage was never formally re-measured.** `STRATEGY.md` §3 named a real go/no-go threshold and said building proceeded ahead of it, trusting that no evidence has pointed toward NO-GO. That's still true by observation, but nobody has gone back and run the actual measurement `SPIKE-01-email-parsing.md` describes. Low urgency given the system works in practice, but it's the one thing that was supposed to be checked and wasn't.
2. **Amex has no parser and no confirmed sender domain.** It's in scope per the original bank list but no sample has ever arrived. If Nat gets an Amex alert forwarded, it'll fall through to FR-4 triage like any new pattern — that's the safe failure mode, just noting it's untested.
3. **Whether the `settlements` table migration was ever applied in Neon is unconfirmed.** This was asked directly after the PR that fixed a related silent-failure bug (`bot.catch`) and no reply was received before the conversation moved to other requests. If `/partner`'s "Mark settled" or the automatic report's settle-up button ever throws, this is the first thing to check.
4. **`docs/LESSONS.md` is missing the `bot.catch` incident.** Only the command-swallowing bug from 2026-08-20 is written up there. The error-handler-not-awaited bug (fixed in PR #25) was root-caused the same way — reading grammY's source directly rather than guessing at infrastructure — and is exactly the kind of incident that document exists to capture. Worth a follow-up entry.
5. **`README.md`, `PRD.md`, `ARCHITECTURE.md`, `STRATEGY.md` all carry stale status lines** ("building", "proposed, pending SPIKE-01"). Not fixed here since they're historical design records and rewriting them risks losing the "why" they document — but a status-line update (pointing to this document) would remove the current confusion between "what was proposed" and "what's live."

## Conventions for continuing work

These aren't written down anywhere else in one place — they're the patterns every PR since #6 or so has followed, mostly because a violation of one of them was the actual bug being fixed at the time.

- **Plain-text Telegram messages only, never `parse_mode:"Markdown"`.** Bank-derived merchant strings routinely contain Markdown-active characters (`WEIXIN*Shanghai`, `SQ *COFFEEBAR`); an odd asterisk count 400s the whole `sendMessage` and the transaction is saved but never announced. See `lib/telegram/notify.ts`'s header comment. (The monthly report's markdown *file attachment* is a different thing — that's a `.md` document sent via `sendDocument`, not a formatted chat message, so it doesn't carry this risk.)
- **All dates in SGT (UTC+8, no DST), computed via `lib/sgt.ts`.** Never assume a bank's stated timezone — DBS's table dates have no year and use the email's own received date to disambiguate; UOB's short-form card-spend date has no time at all and borrows the hour/minute from the email's received timestamp rather than fabricating midnight.
- **`computeRangeSummary()` in `lib/telegram/reports.ts` is the single source of truth for every total** — every report, `/export`, and `/partner`'s settle-up figure all call it rather than re-querying independently. The monthly markdown export's transaction list is built from the same call's `lines` field for the same reason: two independent queries computing "the same" total is exactly how a report and a CSV disagree.
- **A parser never fails silently.** `parse()` returning `null` and a parser throwing are both treated as "this parser can't read this shape" and routed to FR-4/R3 triage — never an uncaught 500 that Apps Script retries forever with no Telegram alert ever sent.
- **New parser shapes are verified against the real forwarded `.eml` sample**, not written from a description of what the email probably says. The working pattern: decode the raw email if needed, run it through the actual parser code via a throwaway script executed with `npx tsx`, confirm the exact parsed output, then delete the script before committing.
- **PR workflow:** branch off fresh `origin/main`, `npm run typecheck` clean before every push, commit messages that explain the root cause rather than just the fix, PR body with a `## Summary` and `## Test plan` (checked items for what was actually verified).

## Operating the system

Full setup steps are in `README.md` — not duplicated here. Quick reference for what's already live:

- **Deploy:** Vercel, auto-deploys `main`. `vercel.json` declares the daily cron (`0 1 * * *` UTC = 9am SGT)
- **Database:** Neon Postgres, migrations via `npm run db:migrate` (or `scripts/migrate-http.mjs` if raw Postgres egress is blocked)
- **Secrets:** `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET`, `INGEST_SECRET`, `CRON_SECRET` — all in Vercel env vars, template in `.env.example`
- **Mail capture:** a dedicated Gmail inbox with a filter forwarding from the five bank domains, polled every 5 minutes by `apps-script/forward-to-ingest.gs`

---

Related: `PRD.md` · `ARCHITECTURE.md` · `STRATEGY.md` · `LESSONS.md` · `README.md`
