# SPIKE-01 — Results (in progress)

**This is not a verdict.** Coverage — the metric that actually decides go/no-go per §5 of `SPIKE-01-email-parsing.md` — has not been measured. This document records early evidence from Step 0/3/4 only: the dedicated inbox is live, and six real forwarded emails confirm format and give a first extraction pass. Steps 1–2 (90-day inventory, statement cross-check) are still open.

---

## What's confirmed

**The dedicated inbox exists and forwarding works.** Nat created `nattytallymonny@gmail.com` and manually forwarded six real alert emails to it on 2026-08-16, ahead of setting up the Gmail auto-forward filter from §0a. This answers SPIKE-01 Step 0 in substance, if not yet via the automated filter.

**Three of the five banks in scope send parseable per-transaction alerts.** DBS, UOB and Trust all confirmed by real sample. Citibank and Amex — no sample yet, still fully unvalidated.

## Corpus — 6 emails, captured 2026-08-16

Sanitised copies (account/card last-4 redacted, amounts and merchant strings intact) live in `spike-01-samples/`.

| # | Bank | Sender | Type | Direction | Amount | Merchant |
|---|---|---|---|---|---|---|
| 1 | UOB | `unialerts@uobgroup.com` | PayNow received | credit | SGD 7.00 | — (P2P, no name) |
| 2 | UOB | `unialerts@uobgroup.com` | Card spend | debit | SGD 149.90 | TOKU NORI |
| 3 | DBS | `paylah.alert@dbs.com` | PayLah spend | debit | SGD 10.60 | HENG LONG T/P(246) |
| 4 | DBS | `ibanking.alert@dbs.com` | Card spend | debit | SGD 13.32 | KOPITIAM FP APP PAYMEN Singapore SGP |
| 5 | Trust | `from_us@trustbank.sg` | Card spend | debit | SGD 20.30 | Cabcharge Asia Pte Ltd SINGAPORE SG |
| 6 | Trust | `from_us@trustbank.sg` | Partial reversal | credit | SGD 0.30 | Cabcharge Asia Pte Ltd SINGAPORE SG (same as #5) |

All six fields the spike cares about — amount, date/time, direction, merchant, account identifier — extracted cleanly by eye from all six emails. That is a 100% hand-extraction rate on a 6-email convenience sample, which is evidence of *parseability*, not a substitute for the held-out accuracy test Step 4 actually specifies once a larger, unbiased corpus exists.

## Sender domains — corrected

`docs/ARCHITECTURE.md`'s original Gmail filter guessed `dbs.com.sg`. That guess was wrong.

| Bank | Guessed | Confirmed | Source |
|---|---|---|---|
| DBS | `dbs.com.sg` | **`dbs.com`** — two addresses seen: `paylah.alert@dbs.com`, `ibanking.alert@dbs.com` | Samples #3, #4 |
| UOB | `uobgroup.com` | **`uobgroup.com`** — confirmed, `unialerts@uobgroup.com` for both card and PayNow alerts | Samples #1, #2 |
| Trust | `trustbank.sg` | **`trustbank.sg`** — confirmed, `from_us@trustbank.sg` | Samples #5, #6 |
| Citibank | `citibank.com.sg` | unconfirmed | — |
| Amex | `americanexpress.com` | unconfirmed | — |

The DBS miss is the exact failure mode `STRATEGY.md` §3 and the Atlas note *The most specific part of a generated spec is the most likely to be invented* warned about — a confident, specific-looking guess that was simply wrong, caught here because real evidence arrived before the filter was built on top of it. `ARCHITECTURE.md` is updated with the corrected domain.

## Format notes, per bank

**DBS — structured, most reliable.** Both sub-types (PayLah, card) use an identical `Date & Time: / Amount: / From: / To:` key-value block, present in both the HTML and plain-text MIME parts, plus a `Transaction Ref`. Two different sending addresses share one template family — a good sign that other DBS notification types will follow the same shape, though that's still an inference from n=2, not a fact.

**UOB — prose, two templates from one sender.** `unialerts@uobgroup.com` sends at least two distinct sentence shapes: `"A transaction of {amount} was made with your UOB Card ending {last4} on {date} at {merchant}"` for card spend, and `"You have received {amount} in your PayNow-linked account ending {last4} on {date}"` for PayNow. A UOB parser has to branch on message content, not assume one template per sender address.

**Trust — prose, and missing a field DBS and UOB both have.** Two templates (`"Yay! Transaction successful"` / `"Transaction partially reversed"`), regex-friendly, but **neither email includes a card or account last-4** — only the card product name (`"Freedom credit card"`). Fine for a single-card setup; would become ambiguous the moment Nat holds two Trust cards of the same product. Flagged, not fixed — nothing to build yet.

**Merchant strings need normalisation across all three banks.** DBS truncates to acquirer codes (`KOPITIAM FP APP PAYMEN`). Trust's HTML-to-plain-text conversion leaves irregular multi-space runs (`Cabcharge Asia Pte Ltd␣␣␣SINGAPORE␣␣␣␣SG`). This confirms the normalisation-layer assumption in `SPIKE-01-email-parsing.md` Step 3 — not a new finding, but no longer a guess either.

## A finding the plan didn't anticipate: partial reversals

Samples #5 and #6 are two separate emails (distinct Message-IDs, ~2 minutes apart) about one purchase: Trust charged SGD 20.30, then released SGD 0.30 back to the same card for the same merchant at the same timestamp. Net cost: SGD 20.00.

`Message-ID` dedup (FR-3) correctly keeps both as separate rows — this isn't a duplicate-detection bug. But naively summing every row as an independent transaction overstates spend by the reversed amount, silently, in every report. `FR-17`'s income-matching design (deferred to Phase 5) was built for a different shape of problem — a *payment* settling a *prior expense*, days later, requiring a manual pick-one-of-five UI. A same-day, same-merchant, opposite-direction reversal from the *same bank* is a much easier signal to catch automatically. Recommend a small addition to Phase 3 scope — flag likely reversals for confirmation, don't auto-net — rather than waiting on the full Phase 5 design. **Open for Nat's call, not decided here.**

## What's still needed before Step 5 can render a verdict

1. **The Step 1 inventory** — search the dedicated inbox (once the auto-forward filter is running) across a full 90 days, or forward forward for two weeks if no history exists
2. **The Step 2 coverage measurement** — cross-check one full month against real statements. This is the number that actually gates go/no-go. Nothing above substitutes for it
3. **Citibank and Amex samples** — currently zero evidence either way
4. **More transaction types per confirmed bank** — GIRO, ATM withdrawal, online vs in-person card spend, and enough volume to run the real 70/30 held-out accuracy split from Step 4, rather than eyeballing six hand-picked examples

## Status

Continue forwarding new alerts as they arrive — every additional sample, especially from Citibank/Amex or an unseen transaction type, narrows the remaining gap. Once ~2 weeks of forwarding has accumulated (or a full month's history is available another way), run Steps 1–2 for real and update this document with an actual verdict.
