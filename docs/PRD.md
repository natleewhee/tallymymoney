# TallyMyMoney — Product Requirements

**Version:** 0.1 · **Date:** 2026-08-16 · **Status:** proposed, pending SPIKE-01
**Supersedes:** `ideation-archive/prd-draft.md`

---

## 1. Problem

Nat's spending is spread across several Singapore bank cards and accounts. Knowing where the money went requires either logging things by hand (which doesn't happen) or reading statements a month later (too late to change anything).

The banks already send an email at the moment of each transaction. That signal exists and is currently thrown away.

## 2. Solution

Catch those emails, ask one question per transaction on Telegram, and produce a monthly picture that is true.

The design constraint that matters: **the per-transaction interaction must cost one tap.** A tracker that takes ten seconds per transaction gets abandoned in a fortnight, and an abandoned tracker is worse than none because it produces confidently wrong totals.

## 3. Users

**One.** Nat.

The partner appears only as a `joint` flag on Nat's own transactions. They do not have an account, do not receive messages, and do not tag anything. "Joint" here means *this expense was shared* — it is a reporting dimension, not a second party in the system.

No other personas. The `ideation-archive/prd-draft.md` personas ("Sarah, 28, Marketing Manager", "John, 22, student") were invented for a product that does not exist and are discarded.

## 4. Non-goals

- Not accounting software, not budgeting, not net worth tracking
- Not multi-currency in v1 — SGD only; foreign-currency transactions record the SGD posted amount. **This assumption is now in question, not decided:** a real Citibank sample (`docs/SPIKE-01-RESULTS.md`) shows a foreign-currency alert with no SGD figure at all — card-network FX conversion posts days later, after the real-time alert already fired. Whether v1 records the original currency instead, or defers foreign-currency transactions until a settlement figure exists, is open for Nat's call before Phase 2
- No investment tracking. That is [[Entry Expert]]'s job and mixing them would damage both
- No web UI. Telegram is the entire interface
- No other users, ever, under the current scale intent
- No settlement, no who-owes-whom, no Splitwise behaviour

## 5. Functional requirements

Priorities are P0 (v1 cannot ship without it), P1 (v1 should have it), P2 (later).

### 5.1 Capture

| ID | Requirement | Pri | Acceptance |
|---|---|---|---|
| FR-1 | Bank alert emails reach the system via the dedicated forwarding inbox | P0 | An alert sent to Nat's Gmail appears at `/api/ingest` within 5 minutes |
| FR-2 | Extract amount, direction, date, merchant, bank, account last-4 | P0 | Meets the accuracy thresholds set in SPIKE-01 |
| FR-3 | The same email can never create two transactions | P0 | Replaying an identical POST changes nothing. Enforced by DB constraint, not application logic |
| FR-4 | **First sighting** of an email pattern — an unrecognised `(sender, subject)` pair, or a previously-working pattern whose parser now returns nothing — triggers a one-time Telegram triage message. It is never silently dropped and never silently assumed to be a transaction | P0 | Nat learns about a new or broken pattern the same day, not at month end, and exactly once per pattern — not once per email |
| FR-20 | The triage message offers two actions: **Ignore this type** or **Needs parser** | P0 | See breakdown below |
| FR-20a | **Ignore this type** writes a permanent rule keyed on `(sender, subject)`. Every future email matching that pair is archived with no Telegram message and no row created | P0 | A monthly-statement email or security notice, once dismissed, never asks again |
| FR-20b | **Needs parser** marks the pattern for rework. Matching emails stop re-alerting (no repeat spam for the same unsolved pattern) but keep accumulating, and the count of pending-parser patterns is surfaced in `/pending` and in every report per FR-15 | P0 | A genuinely new bank notification type gets queued for a real fix instead of nagging Nat or vanishing |
| FR-5 | Once a `(sender, subject)` pair is marked Ignore via FR-20a, matching mail is discarded quietly, permanently, until the rule is manually removed | P1 | Superseded by FR-20a — kept as the steady-state description of the behaviour it produces |

### 5.2 Telegram interaction

| ID | Requirement | Pri | Acceptance |
|---|---|---|---|
| FR-6 | Every new transaction sends a message showing amount, merchant, date, bank | P0 | Arrives within 5 minutes of the bank's email |
| FR-7 | **Known merchant:** the message pre-fills category and split, needing one confirming tap — or one tap to override | P0 | Second and later visits to the same merchant cost one tap |
| FR-8 | **Unknown merchant:** category buttons first, then Solo/Joint | P0 | Resolves the dump's contradiction — the mockups asked Solo/Joint first, the state machine asked category first. Category first wins, because category is what drives merchant memory |
| FR-9 | Tagging a merchant creates or updates its rule in `merchant_rules` | P0 | Third Starbucks transaction needs no category choice |
| FR-10 | An `Ignore` action marks the transaction excluded from all reporting | P0 | Card verification holds, refunds, own-account transfers |
| FR-11 | Description can be edited by replying to the message | P1 | Free text saved against the transaction |
| FR-12 | Untagged transactions can be swept later via `/pending` | P1 | Missing a notification doesn't lose the transaction |
| FR-21 | **Reduce action:** on any transaction — a refund, a partial reversal, cashback, anything that isn't a clean new expense — Nat can tap **Reduce a transaction** instead of categorising it. Shows a short list of recent transactions; picking one nets the current amount off that transaction's total | P0, Phase 3 | Confirmed by Nat 2026-08-16, in response to a real Trust partial-reversal pair found in SPIKE-01 samples (charge SGD 20.30, reversal SGD 0.30 two minutes later). Deliberately manual — no automatic reversal detection. See schema addition (`reduces_transaction_id`) in `ARCHITECTURE.md` |

### 5.3 Reporting

| ID | Requirement | Pri | Acceptance |
|---|---|---|---|
| FR-13 | `/today`, `/week`, `/month` return a summary on demand | P1 | Under 2 seconds |
| FR-14 | A monthly report sends automatically on the 1st, covering the previous month in SGT | P1 | Totals, solo/joint split, category breakdown, top merchants, month-on-month change |
| FR-15 | **Every report states how many transactions are untagged and how many were unparsed** | P0 | A report that hides its own incompleteness is worse than no report. This is what stops R1/R2 becoming silently wrong numbers |
| FR-16 | `/export` returns a CSV for a date range | P2 | Replaces the dump's Google Sheets archive entirely |

### 5.4 Deferred to Phase 5

| ID | Requirement | Note |
|---|---|---|
| FR-17 | Match an incoming payment to prior expenses — the general case: one payment settling several expenses, or something older than FR-21's short recent list | The dump's "show last 5 expenses" fails on partial repayments and multi-expense settlement. Needs a real design before it is worth building. **The narrower same-transaction-refund case is no longer deferred** — see FR-21, confirmed by Nat 2026-08-16 |

### 5.5 Manual entry and partner visibility — confirmed 2026-08-16

| ID | Requirement | Pri | Acceptance |
|---|---|---|---|
| FR-18 | Manual quick-entry: a free-text message (`"12.50 kopi"`) is parsed into a transaction the same as an email-derived one | **P1**, Phase 3 | Without this, cash and below-alert-threshold spending are permanently invisible and every monthly total silently understates. Promoted from "recommended" to committed scope — confirmed by Nat, see R2 in `STRATEGY.md` |
| FR-19 | A partner-facing summary generates **only on request** — a command such as `/partner` — never automatically | P1, Phase 4 | No standing access, no scheduled send to the partner. D4 still holds: they never interact with the bot directly. Nat asks, Nat forwards (or the bot sends to a second chat Nat specifies at call time) |

## 6. Categories

**Confirmed 2026-08-16: start with the generic eight**, carried from `ideation-archive/categories.py`, no Singapore-specific splits for v1:

`Food & Dining` · `Groceries` · `Transport` · `Household` · `Utilities` · `Healthcare` · `Entertainment` · `Shopping` · `Other`

Splitting a category (Transport → Grab/public/petrol/parking, for instance) is a live option once one of these proves too coarse in practice — not a v1 decision.

## 7. Non-functional

Sized for one person generating roughly 50–150 transactions a month. The dump's "10,000 transactions/month, 1,000 emails/day, 99.9% uptime" figures were cargo-culted and are discarded.

| Property | Target |
|---|---|
| Email → Telegram latency | < 6 minutes (5-minute trigger + processing) |
| Button response | < 2 seconds |
| Availability | Best effort. A missed hour costs nothing — the email is still in the inbox and gets picked up on the next run |
| Durability | No transaction silently lost. `raw_email` retained so a bad parse can be re-run against history |
| Cost | $0/month |

## 8. Success

Not measured in DAU or retention. This works if, after three months:

1. Nat can answer "where did the money go last month" in under a minute, and
2. He believes the number — meaning untagged and unparsed counts are consistently low, and
3. Tagging never felt like a chore worth muting

If tagging becomes a chore, the product has failed regardless of what the numbers say.
