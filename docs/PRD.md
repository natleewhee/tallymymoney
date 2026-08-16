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
- Not multi-currency in v1 — SGD only; foreign-currency transactions record the SGD posted amount
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
| FR-4 | An email that cannot be parsed produces a Telegram alert and an `unparsed` row | P0 | Nat learns about a broken parser the same day, not at month end |
| FR-5 | Non-transaction mail (statements, marketing, security notices) is discarded quietly | P1 | No Telegram noise from a monthly statement email |

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
| FR-17 | Match an incoming payment to prior expenses | The dump's "show last 5 expenses" fails on partial repayments, one payment settling several expenses, and anything older than a few days. Needs a real design before it is worth building |

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
