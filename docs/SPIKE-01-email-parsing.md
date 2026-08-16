# SPIKE-01 — Can bank alert emails carry this product?

**Status:** not started · **Blocks:** everything · **Effort:** ~1 day of work, ~2 weeks wall-clock

---

## The question

> For every transaction Nat makes, does a bank email arrive, and can amount / date / merchant / direction be extracted from it reliably?

Two failure modes, and they are different:

- **Coverage failure** — the email never arrives. Unfixable in code. Kills the project.
- **Extraction failure** — the email arrives but parsing it is unreliable. Fixable, at a cost.

The spike must separate these, because the response to each is completely different.

## Why this comes before any code

`ideation-archive/bank_patterns.py` and `email_scanner.py` contain confident-looking regexes for DBS, OCBC and Citibank. They were generated, not observed. Building on them would mean discovering the product's core assumption is wrong *after* the schema, the bot and the deployment already exist.

The cost of being wrong here is a week. The cost of being wrong in Phase 4 is the project.

---

## Step 0 — Switch the alerts on (do this today)

This is a prerequisite, not part of the measurement, and it gates the whole timeline.

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
| DBS | | | | |
| OCBC | | | | |
| UOB | | | | |
| *(others — confirm the real list)* | | | | |

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

- [ ] Step 0 completed, per-bank alert settings recorded
- [ ] `SPIKE-01-RESULTS.md` — inventory, coverage table, stability notes, accuracy table, verdict
- [ ] A sanitised corpus of sample emails, amounts and account numbers redacted, kept as parser test fixtures
- [ ] A recommendation on D2: does the forward-to-dedicated-address route survive contact with reality?

## Out of scope

No schema. No Telegram bot. No deployment. No Next.js project. If the spike starts growing an application, it has stopped being a spike.
