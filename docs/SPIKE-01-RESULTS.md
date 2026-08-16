# SPIKE-01 — Results (in progress)

**This is not a verdict.** Coverage — the metric that actually decides go/no-go per §5 of `SPIKE-01-email-parsing.md` — has not been measured. This document records early evidence from Step 0/3/4 only: the dedicated inbox is live, and six real forwarded emails confirm format and give a first extraction pass. Steps 1–2 (90-day inventory, statement cross-check) are still open.

---

## What's confirmed

**The dedicated inbox exists and the auto-forward filter is live.** Nat created `nattytallymonny@gmail.com`, manually forwarded nine real samples on 2026-08-16 to seed this document, then set up the actual Gmail filter the same day — matching the five confirmed sender addresses, skip-inbox, labelled. Step 0 is now fully done. From this point, capture is unattended; nothing further needs to be manually forwarded for the banks already confirmed.

**All five banks in scope have now produced at least one real, parseable per-transaction alert.** DBS, UOB, Trust and Citibank confirmed by sample as of this update. Amex remains the one bank with zero evidence either way.

## Corpus — 9 emails, captured 2026-08-16

Sanitised copies (account/card numbers and any real personal names redacted; amounts and merchant strings intact) live in `spike-01-samples/`.

| # | Bank | Sender | Type | Direction | Amount | Merchant |
|---|---|---|---|---|---|---|
| 1 | UOB | `unialerts@uobgroup.com` | PayNow received | credit | SGD 7.00 | — (P2P, genuinely no name in the email — confirmed by Nat, not a parse gap) |
| 2 | UOB | `unialerts@uobgroup.com` | Card spend | debit | SGD 149.90 | TOKU NORI |
| 3 | DBS | `paylah.alert@dbs.com` | PayLah spend | debit | SGD 10.60 | HENG LONG T/P(246) |
| 4 | DBS | `ibanking.alert@dbs.com` | Card spend | debit | SGD 13.32 | KOPITIAM FP APP PAYMEN Singapore SGP |
| 5 | Trust | `from_us@trustbank.sg` | Card spend | debit | SGD 20.30 | Cabcharge Asia Pte Ltd SINGAPORE SG |
| 6 | Trust | `from_us@trustbank.sg` | Partial reversal | credit | SGD 0.30 | Cabcharge Asia Pte Ltd SINGAPORE SG (same as #5) |
| 7 | DBS | `ibanking.alert@dbs.com` | PayNow received | credit | SGD 200.00 | a real person's name (redacted in the fixture) |
| 8 | DBS | `ibanking.alert@dbs.com` | PayNow sent | debit | SGD 30.00 | name partially masked by DBS itself (`SHAXX LOX ZHX QUXX`) |
| 9 | Citibank | `alerts@citibank.com.sg` | Card spend, foreign currency | debit | **JPY 102,080.00** — no SGD amount given | BKG*Hakoneji Kaiun Amsterdam NLD |

Every field the spike cares about — amount, date/time, direction, merchant, account identifier — extracted cleanly by eye from all nine emails. That's evidence of *parseability* on a hand-picked convenience sample, not a substitute for the held-out accuracy test Step 4 actually specifies once a larger, unbiased corpus exists.

## Sender domains — corrected, then confirmed

`docs/ARCHITECTURE.md`'s original Gmail filter guessed `dbs.com.sg`. That guess was wrong. The Citibank guess, by contrast, was right on the first sample.

| Bank | Guessed | Confirmed | Source |
|---|---|---|---|
| DBS | `dbs.com.sg` | **`dbs.com`** — three addresses/relays seen: `paylah.alert@dbs.com`, `ibanking.alert@dbs.com` direct, and `ibanking.alert@dbs.com` via Amazon SES (`amazonses.com`, DKIM-signed by `dbs.com`) | Samples #3, #4, #7, #8 |
| UOB | `uobgroup.com` | **`uobgroup.com`** — confirmed, `unialerts@uobgroup.com` for both card and PayNow alerts | Samples #1, #2 |
| Trust | `trustbank.sg` | **`trustbank.sg`** — confirmed, `from_us@trustbank.sg` | Samples #5, #6 |
| Citibank | `citibank.com.sg` | **`citibank.com.sg`** — confirmed, `alerts@citibank.com.sg`, guess was correct | Sample #9 |
| Amex | `americanexpress.com` | unconfirmed | — |

The DBS miss is the exact failure mode `STRATEGY.md` §3 and the Atlas note *The most specific part of a generated spec is the most likely to be invented* warned about — a confident, specific-looking guess that was simply wrong, caught here because real evidence arrived before the filter was built on top of it. The Citibank hit is the useful counter-case: not every guess is wrong, which is exactly why guesses still need checking rather than either blindly trusting or blindly discarding them. `ARCHITECTURE.md` is updated with both.

**DBS mail arrives two ways.** Samples #3/#4 are Gmail-forwarded copies (wrapped in a "Forwarded message" quote, both HTML and plain-text MIME parts present). Samples #7/#8 are raw originals Nat pulled directly from his real inbox — no forward wrapper, delivered via Amazon SES on DBS's behalf, and **HTML-only, no plain-text part at all**. A parser that only reads `text/plain` will silently miss this second delivery path. Since production ingestion reads whatever Gmail's auto-forward actually delivers (closer to the #7/#8 shape than the manually-forwarded #3/#4 shape), the parser must handle HTML-only mail as the norm, not the exception.

## Format notes, per bank

**DBS — structured, most reliable, but not one-size.** Four sub-types seen (PayLah spend, card spend, PayNow received, PayNow sent) across two sending addresses. Card spend, PayNow received (#7) and PayNow sent (#8) all use a `Date & Time: / Amount: / From: / To:` key-value block; PayNow received via Gmail-forward (#3... actually see #7) uses inline labels without a table. Four distinct subject lines observed so far, one of them (`"iBanking Alerts"`) generic enough that it may not be unique to a single transaction type — flagged in `spike-01-samples/08-dbs-paynow-sent.txt`, not yet resolved either way.

**UOB — prose, two templates from one sender.** `unialerts@uobgroup.com` sends at least two distinct sentence shapes: `"A transaction of {amount} was made with your UOB Card ending {last4} on {date} at {merchant}"` for card spend, and `"You have received {amount} in your PayNow-linked account ending {last4} on {date}"` for PayNow. A UOB parser has to branch on message content, not assume one template per sender address.

**Trust — prose. Missing last-4, and that's fine.** Two templates (`"Yay! Transaction successful"` / `"Transaction partially reversed"`), regex-friendly. Neither email includes a card or account last-4 — only the card product name, currently "Freedom." **Resolved by Nat 2026-08-16: not a risk.** Nat holds one Trust card; use the card name itself (e.g. "Freedom") as the account identifier for Trust rows, no last-4 needed. Revisit only if a second Trust card is ever added.

**Citibank — structured, colon-aligned, and the domain guess was right.** `Account Number : / Transaction date : / Transaction time : / Transaction amount : / Transaction details :` — clean key-value, easy to parse. But see the currency finding below: this specific sample carries no SGD amount at all.

**Merchant strings need normalisation across every bank seen so far.** DBS truncates to acquirer codes (`KOPITIAM FP APP PAYMEN`). Trust's HTML-to-plain-text conversion leaves irregular multi-space runs (`Cabcharge Asia Pte Ltd␣␣␣SINGAPORE␣␣␣␣SG`). Citibank's sample (#9) shows a third variant: a Booking.com acquirer prefix (`BKG*Hakoneji Kaiun`) routed through a Netherlands acquirer for what's actually a Japanese business — the string reflects payment routing, not geography or the real business name. This confirms the normalisation-layer assumption in `SPIKE-01-email-parsing.md` Step 3 three times over — not a new finding, but no longer a guess either.

## A finding the plan didn't anticipate: partial reversals — resolved by Nat, no auto-detection

Samples #5 and #6 are two separate emails (distinct Message-IDs, ~2 minutes apart) about one purchase: Trust charged SGD 20.30, then released SGD 0.30 back to the same card for the same merchant at the same timestamp. Net cost: SGD 20.00.

`Message-ID` dedup (FR-3) correctly keeps both as separate rows — this isn't a duplicate-detection bug. But naively summing every row as an independent transaction overstates spend by the reversed amount, silently, in every report.

**Resolved by Nat 2026-08-16: no automatic reversal detection.** Instead, any transaction gets a manual **Reduce a transaction** action — pick from a short list of recent transactions, the credit nets against the chosen one — alongside the existing **Ignore**. Simpler than the auto-linking I'd originally floated, and simpler than `FR-17`'s full income-matching design (still deferred to Phase 5 for the harder cases — multiple expenses settled by one payment, or anything outside the recent list). Written up as FR-21 in `PRD.md`; schema addition (`reduces_transaction_id`) in `ARCHITECTURE.md`.

## A second finding the plan didn't anticipate: foreign-currency alerts may carry no SGD amount — resolved by Nat

Sample #9 (Citibank, JPY 102,080.00 at a Japan-based merchant) contains no SGD figure anywhere in the email. Card-network FX conversion posts to SGD days after the original charge — the real-time alert fires before that number exists, so no bank's real-time alert can plausibly contain it for a foreign-currency purchase. This isn't a Citibank-specific gap; expect it from any bank whenever the transaction wasn't in SGD to begin with.

**Resolved by Nat 2026-08-16: "for FX, just assume spot rate, and allow me to amend once I check the actual statement."** Ingest converts at spot rate immediately (Frankfurter, ECB reference rates — free, no key), flags the result as an estimate, and Nat corrects it later once the real posted SGD amount is known. Written up as FR-2/FR-22 in `PRD.md`; schema (`sgd_amount_cents`, `fx_source`, `fx_rate`) in `ARCHITECTURE.md`. Worth remembering going in: a spot/interbank rate will not match the card network's actual conversion, which typically carries a 1–3% markup — the estimate and the eventual statement figure are expected to differ, that's exactly what FR-22 exists to fix, not a sign anything is broken.

## What's still needed before Step 5 can render a verdict

1. **The Step 1 inventory** — search the dedicated inbox (once the auto-forward filter is running) across a full 90 days, or forward forward for two weeks if no history exists
2. **The Step 2 coverage measurement** — cross-check one full month against real statements. This is the number that actually gates go/no-go. Nothing above substitutes for it
3. **Amex samples** — the one remaining bank in scope with zero evidence
4. **More transaction types per confirmed bank** — GIRO, ATM withdrawal, online vs in-person card spend, and enough volume to run the real 70/30 held-out accuracy split from Step 4, rather than eyeballing nine hand-picked examples
5. Confirmation of whether `"iBanking Alerts"` as a DBS subject line is ambiguous across transaction types — minor, not blocking

Both open findings from this batch (partial reversals, foreign-currency amounts) are now resolved — see above.

## Status

**The auto-forward filter went live 2026-08-16 — this is when the real coverage clock starts.** Everything above is convenience-sample evidence collected before automated capture existed; it proves parseability, not coverage. From today, the dedicated inbox accumulates unattended, and Steps 1–2 (the real inventory and the statement cross-check that actually renders a verdict) become possible once ~2 weeks have passed, or sooner if Nat can pull a statement for a period that overlaps with what's landed in the inbox so far.

Two things still open, unrelated to the wait: per-bank alert thresholds haven't been confirmed at minimum (checklist item in `SPIKE-01-email-parsing.md`), and whether the Gmail filter's "apply to matching conversations" backfill option was used — if so, some history may already be sitting in the dedicated inbox and the wait could be shorter than two weeks.

**Confirmed by Nat 2026-08-16: yes to both.** Backfill was applied — the dedicated inbox already holds some pre-filter history, not just fresh forward-only mail. Alert thresholds are confirmed at minimum across banks. Step 0 is now fully closed.

## Decision: proceeding to build ahead of the coverage verdict

Nat's call, 2026-08-16: start Phase 2 (capture pipeline) and Phase 3 (Telegram bot) now, rather than waiting out the full ~2-week coverage measurement first. Recorded here rather than silently overriding `STRATEGY.md`'s original phasing.

Why this is defensible rather than reckless: every bank in scope has produced at least one cleanly-parsed real sample (9/9), the manual quick-entry fallback (FR-18) exists specifically to absorb whatever coverage gaps turn out to be real, and nothing built so far is wasted if the eventual coverage number comes back CONDITIONAL rather than GO — the parsers and schema don't change, only how much weight falls on FR-18. A genuine NO-GO (<70%, per the Step 5 table) would be the one outcome that actually invalidates this decision; nothing in the evidence so far points that way, but it hasn't been ruled out either. Steps 1–2 keep running in the background regardless — see `STRATEGY.md` for the updated phase status.
