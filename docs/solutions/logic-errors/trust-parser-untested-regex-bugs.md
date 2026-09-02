---
title: Zero test coverage let three Trust-parser regex bugs ship undetected
date: 2026-09-02
category: logic-errors
module: lib/parsers/trust.ts
problem_type: logic_error
component: service_layer
symptoms:
  - "Trust bank emails matching docs/spike-01-samples/05 and /06 would have failed every parser and fallen through to unclassified-email triage"
  - "A parsed Trust transaction's accountIdentifier came back \"Freedom credit\" instead of \"Freedom\""
root_cause: test_isolation
resolution_type: code_fix
severity: high
tags: [parsers, regex, test-coverage, trust-bank]
---

# Zero test coverage let three Trust-parser regex bugs ship undetected

## Problem

`lib/parsers/trust.ts` had three regex bugs that meant every real Trust
bank email would have failed to parse and silently fallen through to
FR-4 unclassified-email triage instead of being recorded as a
transaction. None of the ten real bank-email samples in
`docs/spike-01-samples/` had ever been run through the actual parsers
before a `ce-code-review` pass added the repo's first test suite
(`tests/parsers.test.ts`) — the samples existed only as
hand-annotated documentation, not executable fixtures.

## Symptoms

- Writing `tests/parsers.test.ts` against the real samples immediately
  failed on `05-trust-card-spend.txt` and `06-trust-partial-reversal.txt`
  with "transaction is falsy" or a wrong `accountIdentifier` value —
  the parser code itself had never been exercised against its own
  documented ground truth.

## What Didn't Work

Nothing — this was caught on the first run of the new tests, before any
of it reached a real Trust email in production. Documented here because
the *absence* of a failed attempt is itself the point: with no tests,
these three bugs had no mechanism to surface at all before a real
email hit them.

## Solution

Three independent regex fixes in `lib/parsers/trust.ts`:

1. **Apostrophe character class excluded the plain ASCII apostrophe.**
   `You[''`]?ve spent` and `We[''`]?ve ...` only matched a curly
   right/left single quote or a backtick — never a straight `'`. The
   real sample corpus uses a straight apostrophe (`You've spent`), so
   every domestic-spend and partial-reversal Trust email failed to
   match at all. Fixed by adding `'` to the class: `[''`']?`.

2. **"credit" swallowed into the card-name capture.** The real prose is
   `with Freedom credit card.`, but the regex expected a literal
   `\s+card` right after the captured name, so the non-greedy capture
   had to extend past "Freedom" to "Freedom credit" before it could
   match. Fixed by making "credit" an optional literal in the pattern:
   `\s+(?:credit\s+)?card`.

3. **Merchant capture couldn't cross a mid-name line wrap.** The real
   plain-text body wraps at the mail client's line width, sometimes
   mid-merchant-name (`Cabcharge Asia Pte Ltd SINGAPORE\nSG`). The
   merchant capture used `.` (never matches `\n`), so it could not span
   the wrap. Fixed by switching those capture groups to `[\s\S]+?`.

```ts
// Before
/You[''`]?ve spent\s+(SGD\s*[\d,]+\.\d+)\s+at\s+(.+?)\s+on\s+.../i

// After
/You[''`']?ve spent\s+(SGD\s*[\d,]+\.\d+)\s+at\s+([\s\S]+?)\s+on\s+.../i
//         ^ added '                              ^ was "."
```

`lib/telegram/bot.ts`'s "c" (category-set) callback also picked up a
related-but-separate fix in the same pass: it used `.returning()` to
confirm the update actually matched a row, instead of unconditionally
reporting success — see the PR for that change; it isn't a parser
regex issue so it isn't detailed here.

## Why This Works

Each bug is now pinned by a fixture test asserting the currently-correct
parsed output for a real sample email, so a future edit to
`lib/parsers/trust.ts` (or `lib/parsers/dates.ts`) that reintroduces
any of these three failure modes fails `npm test` immediately, in CI
or locally, instead of surfacing only when a real Trust email hits
production — exactly the class of incident `docs/LESSONS.md` already
records for other parsers (the Dec/Jan year-rollover bug, the UOB
midnight-time bug).

## Prevention

- `npm test` now runs `tests/parsers.test.ts`, which dispatches all ten
  `docs/spike-01-samples/` fixtures through the real parsers. Any new
  bank sample added to that directory should get a corresponding test
  case in the same file — a sample that only exists as documentation
  protects nothing.
- When a parser regex captures free text bounded by a literal delimiter
  (a name before "card", a merchant before "on <date>"), prefer
  `[\s\S]+?` over `.+?` unless there's a specific reason to stop at a
  line boundary (e.g. DBS's one-field-per-line "From:"/"To:" table
  shape genuinely relies on `[^\n]`). Defaulting to `.` silently assumes
  the field never wraps, which is a wrong assumption for real,
  variable-length bank-alert prose.
- When a regex anchors on an apostrophe in natural-language prose ("You've",
  "We've"), include the plain ASCII apostrophe (`'`) in the character
  class alongside any curly-quote variants — don't assume the source
  always uses a typographic quote.

## Related Issues

- `docs/LESSONS.md` — prior production incidents from the same root
  cause (parser/date logic that looked correct but was never run
  against a real sample before shipping).
- PR that introduced `tests/parsers.test.ts` and these fixes (see git
  history on `lib/parsers/trust.ts` and `tests/parsers.test.ts` from
  the same commit).
