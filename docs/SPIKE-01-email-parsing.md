# SPIKE-01 — Can bank alert emails carry this product?

**Status:** in progress — Step 0 done (dedicated inbox live, auto-forward filter live as of 2026-08-16), Steps 3–4 have early evidence, Steps 1–2 (coverage) not started, clock now running · **Blocks:** everything · **Effort:** ~1 day of work, ~2 weeks wall-clock

---

## The question

> For every transaction Nat makes, does a bank email arrive, and can amount / date / merchant / direction be extracted from it reliably?

Two failure modes, and they are different:

- **Coverage failure** — the email never arrives. Unfixable in code. Kills the project.
- **Extraction failure** — the email arrives but parsing it is unreliable. Fixable, at a cost.

The spike must separate these, because the response to each is completely different.

## Why this comes before any code

`ideation-archive/bank_patterns.py` and `email_scanner.py` contain confident-looking regexes for DBS, OCBC and Citibank. They were generated, not observed. Building on them would mean discovering the product's core assumption is wrong *after* the schema, the bot and the deployment already exist.

**Banks in scope, confirmed by Nat 2026-08-16: DBS, UOB, Citibank, Trust, Amex.** OCBC is not a Nat account and drops out of scope; Trust and Amex are added below, neither of which the ideation dump ever considered.

The cost of being wrong here is a week. The cost of being wrong in Phase 4 is the project.

---

## Step 0 — Switch the alerts on (do this today)

This is a prerequisite, not part of the measurement, and it gates the whole timeline.

### 0a — Create the dedicated inbox

Yes, a separate address is needed — this is what makes D2 safe. Recommend a plain free Gmail account rather than an alias, since Apps Script (§0c) needs to run *as* the account that owns the mailbox, and a `+alias` on the existing Gmail doesn't give that.

- [ ] Create a new Gmail account, e.g. `tallymymoneyalerts@gmail.com` (name doesn't matter, only Nat and the banks ever see it)
- [ ] In the **main** Gmail — Settings → **Forwarding and POP/IMAP** → *Add a forwarding address* → enter the new address
- [ ] Gmail sends a confirmation code to the new address. Log into it, retrieve the code, paste it back into the main account's forwarding settings to confirm
- [ ] In the main Gmail, create a **filter**: `from:(<bank domains>)` → *Forward to* the new address, and **Skip Inbox (Archive it)** so alert mail doesn't clutter the real inbox but stays retrievable there too. Do **not** select Delete — the main inbox stays the backup copy
- [ ] The new account is where SPIKE-01's later inventory step runs, and later where the Apps Script trigger lives

### 0b — Enable alerts, per bank

For each bank, in ibanking/app notification settings:

- [ ] Enable **email** transaction alerts (not just push — push notifications cannot be parsed)
- [ ] Set the alert threshold to the **lowest permitted value** (ideally S$0.01). A default threshold of S$100 or S$500 is the single most likely cause of coverage failure, and it is often on by default
- [ ] Enable alerts for **both** card and account/transfer activity where they are separate settings
- [ ] Record, per bank: what was already on, what had to be changed, and the minimum threshold available

**If historical alert emails don't exist**, Steps 1–2 cannot look backwards and the spike becomes a **two-week forward collection**. Expect this. It is the reason Phase 1's wall-clock is two weeks against one day of work.

## Step 1 — Inventory

Search the mailbox for the last 90 days across every bank Nat holds.

| Bank / card | Alert emails found (90d) | Per-transaction? | Threshold in force | Notes |
|---|---|---|---|---|
| DBS | not yet searched | **yes**, confirmed by sample — 4 sub-types seen (PayLah spend, card spend, PayNow received, PayNow sent) | unknown | One template family across sub-types; HTML-only for two of the four, no plain-text part. See `SPIKE-01-RESULTS.md` |
| UOB | not yet searched | **yes**, confirmed by sample — card spend + PayNow received | unknown | One sending address for both alert types |
| Citibank | not yet searched | **yes**, confirmed by sample — card spend (foreign currency) | unknown | Domain guess was correct on the first sample. That sample carries no SGD amount — a live open question, see `SPIKE-01-RESULTS.md` |
| Trust | not yet searched | **yes**, confirmed by sample — spend + partial reversal | unknown | No card last-4 in the alert body, only card product name ("Freedom") — resolved as a non-issue by Nat, single-card setup |
| Amex | not yet searched | unknown — no sample yet | unknown | The one bank in scope with zero evidence |

**"Not yet searched" is the operative gap.** Nine forwarded samples from 2026-08-16 confirm DBS/UOB/Trust/Citibank *can* send parseable per-transaction alerts, and are strong evidence for Steps 3–4 (format, extraction). They say nothing about *coverage* — whether every transaction produces one. That still needs the actual 90-day search and the Step 2 statement cross-check below. Amex remains completely unvalidated: no sample has been seen.

Classify each sender: **per-transaction alert** / statement / marketing / security notice. Only the first category matters.

## Step 2 — Coverage (the metric that decides go/no-go)

Take **one complete calendar month**. Pull the actual card and account statements. For every real transaction on the statement, check whether an alert email exists.

```
coverage = transactions with a matching alert email / all real transactions
```

Break it down, because an aggregate number hides the thing that matters:

| Segment | Coverage | Comment |
|---|---|---|
| Card, in person | | |
| Card, online | | |
| PayNow / transfers out | | |
| GIRO / recurring | | |
| Incoming payments | | |
| ATM / cash withdrawal | | |
| **Cash spending** | **0% by definition** | No bank event exists. See R2 in `STRATEGY.md` |

A 95% aggregate is worthless if it is 100% on card and 0% on transfers — that is a structural blind spot, not a rounding error.

## Step 3 — Format stability

Ten emails per bank, spread across the full 90 days.

- Is it HTML, plain text, or both?
- Is the structure identical across the sample, or has the template changed within the window?
- Are amount and merchant in predictable positions, or free-prose?
- Is the merchant string usable, or is it a truncated acquirer code (`NTUC FP#123 SINGAPORE SG`)?
- Is the transaction date in the body, or does it have to be inferred from the email's received time?

Merchant quality is the one most likely to disappoint. Plan for a normalisation layer regardless.

**Early evidence, six samples, 2026-08-16:** see `SPIKE-01-RESULTS.md` for the full breakdown. Headline — DBS uses a stable structured key-value format across two sub-brands; UOB and Trust use single-sentence prose, consistent within each bank but different from each other; Trust's HTML-to-text conversion introduces irregular whitespace in the merchant string, confirming the normalisation layer is not optional. Ten-per-bank sampling across the full 90 days is still needed before this step can be marked done.

## Step 4 — Extraction accuracy

Write throwaway parsers. Throwaway is the point — this is measurement, not the product.

Split the corpus: build against 70%, measure against a held-out 30% never looked at during development.

| Field | Accuracy on held-out set | Threshold |
|---|---|---|
| Amount | | ≥99% |
| Date | | ≥99% |
| Direction (debit/credit) | | ≥99% |
| Merchant (usable string) | | ≥85% |
| Account / card identifier | | ≥90% |

Amount and date carry a hard threshold because a wrong number is worse than no number — it produces a report that is confidently incorrect, and nothing downstream would catch it.

## Step 5 — Verdict

| Coverage | Extraction | Verdict |
|---|---|---|
| ≥90% | meets thresholds | **GO** — proceed to Phase 2 as designed |
| ≥90% | below thresholds | **GO, revised** — build the pipeline, budget extra time for parsers, add a confirm-the-amount step in the Telegram flow |
| 70–90% | any | **CONDITIONAL** — the gap must be named and closed. Manual quick-entry (R2) stops being optional and becomes required scope |
| <70% | any | **NO-GO on email capture** — pivot to statement CSV/PDF import, which trades real-time notification for completeness. Re-open the D2 decision with Nat |

Write the verdict, with the evidence table, into `docs/SPIKE-01-RESULTS.md`. Including — especially including — a no-go.

---

## Deliverables

- [x] Dedicated inbox created and receiving forwarded mail (`nattytallymonny@gmail.com`)
- [x] Auto-forward filter live on the main account as of 2026-08-16 — matching `paylah.alert@dbs.com`, `ibanking.alert@dbs.com`, `unialerts@uobgroup.com`, `from_us@trustbank.sg`, `alerts@citibank.com.sg`, skip-inbox, labelled. Amex not yet in the filter — no confirmed sender address
- [ ] Per-bank alert threshold settings (email alerts on, minimum $ threshold) — not yet confirmed per bank
- [~] `SPIKE-01-RESULTS.md` — started, early format/extraction evidence recorded; coverage table, full inventory and verdict still open
- [~] Sanitised corpus — 6 fixtures in `spike-01-samples/`, account numbers redacted, amounts kept (needed for accuracy testing, a deliberate deviation from "redacted" — see the file headers for why)
- [ ] A recommendation on D2: does the forward-to-dedicated-address route survive contact with reality?

## Out of scope

No schema. No Telegram bot. No deployment. No Next.js project. If the spike starts growing an application, it has stopped being a spike.
