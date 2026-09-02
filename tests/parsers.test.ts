// Regression coverage for the bank-email parsers using the real sample
// corpus in docs/spike-01-samples/ (see SPIKE-01-RESULTS.md). Before
// this file, none of these ten samples were exercised by anything —
// docs/LESSONS.md documents parser/date regressions (Dec/Jan rollover,
// UOB midnight-time bug, credits not counted) that shipped and were
// only caught in production. These tests pin the currently-correct
// behaviour so a future change to the parsers or dates.ts breaks a test
// instead of a live transaction.

import { test } from "node:test";
import assert from "node:assert/strict";
import { dispatch } from "../lib/parsers/index.ts";
import { loadSample } from "./fixtures.ts";

test("01: UOB PayNow received", () => {
  const email = loadSample("01-uob-paynow-received.txt", new Date("2026-08-11T00:00:00Z"));
  const { bank, transaction } = dispatch(email);
  assert.equal(bank, "UOB");
  assert.ok(transaction);
  assert.equal(transaction.direction, "credit");
  assert.equal(transaction.currency, "SGD");
  assert.equal(transaction.amountCents, 700);
  assert.equal(transaction.merchantRaw, null);
  assert.equal(transaction.occurredAt.toISOString(), "2026-08-11T05:44:00.000Z");
});

test("02: UOB card spend (no time in body — borrowed from receivedAt)", () => {
  const receivedAt = new Date(Date.UTC(2026, 7, 9, 5, 30)); // 13:30 SGT
  const email = loadSample("02-uob-card-spend.txt", receivedAt);
  const { bank, transaction } = dispatch(email);
  assert.equal(bank, "UOB");
  assert.ok(transaction);
  assert.equal(transaction.direction, "debit");
  assert.equal(transaction.amountCents, 14990);
  assert.equal(transaction.merchantRaw, "TOKU NORI");
  // The bank vouches only for the calendar day; hour/minute borrow from
  // receivedAt (see dates.ts parseUobShortDate).
  assert.equal(transaction.occurredAt.getTime(), receivedAt.getTime());
});

test("03: DBS PayLah spend (table shape)", () => {
  const email = loadSample("03-dbs-paylah-spend.txt", new Date(Date.UTC(2026, 7, 16)));
  const { bank, transaction } = dispatch(email);
  assert.equal(bank, "DBS");
  assert.ok(transaction);
  assert.equal(transaction.direction, "debit");
  assert.equal(transaction.amountCents, 1060);
  assert.equal(transaction.merchantRaw, "HENG LONG T/P(246)");
  assert.equal(transaction.occurredAt.toISOString(), "2026-08-16T04:43:00.000Z");
});

test("04: DBS card spend (table shape, acquirer-truncated merchant)", () => {
  const email = loadSample("04-dbs-card-spend.txt", new Date(Date.UTC(2026, 7, 16)));
  const { bank, transaction } = dispatch(email);
  assert.equal(bank, "DBS");
  assert.ok(transaction);
  assert.equal(transaction.direction, "debit");
  assert.equal(transaction.amountCents, 1332);
  assert.equal(transaction.merchantRaw, "KOPITIAM FP APP PAYMEN Singapore SGP");
  assert.equal(transaction.occurredAt.toISOString(), "2026-08-16T10:56:00.000Z");
});

test("05: Trust domestic card spend (whitespace-normalised merchant)", () => {
  const email = loadSample("05-trust-card-spend.txt", new Date(Date.UTC(2026, 7, 16)));
  const { bank, transaction } = dispatch(email);
  assert.equal(bank, "Trust");
  assert.ok(transaction);
  assert.equal(transaction.direction, "debit");
  assert.equal(transaction.currency, "SGD");
  assert.equal(transaction.amountCents, 2030);
  assert.equal(transaction.merchantRaw, "Cabcharge Asia Pte Ltd SINGAPORE SG");
  assert.equal(transaction.accountIdentifier, "Freedom");
  assert.equal(transaction.occurredAt.toISOString(), "2026-08-16T04:45:00.000Z");
});

test("06: Trust partial reversal — distinct email, same merchant+timestamp as 05", () => {
  const email = loadSample("06-trust-partial-reversal.txt", new Date(Date.UTC(2026, 7, 16)));
  const { bank, transaction } = dispatch(email);
  assert.equal(bank, "Trust");
  assert.ok(transaction);
  assert.equal(transaction.direction, "credit");
  assert.equal(transaction.amountCents, 30);
  assert.equal(transaction.merchantRaw, "Cabcharge Asia Pte Ltd SINGAPORE SG");
  // Same timestamp as the original charge (05) — the reversal-linking
  // signal docs/spike-01-samples/06 describes.
  assert.equal(transaction.occurredAt.toISOString(), "2026-08-16T04:45:00.000Z");
});

test("07: DBS PayNow received (inline shape, explicit year, HTML-only email)", () => {
  const email = loadSample("07-dbs-paynow-received.txt", new Date(Date.UTC(2026, 7, 11)));
  const { bank, transaction } = dispatch(email);
  assert.equal(bank, "DBS");
  assert.ok(transaction);
  assert.equal(transaction.direction, "credit");
  assert.equal(transaction.amountCents, 20000);
  assert.equal(transaction.occurredAt.toISOString(), "2026-08-11T09:17:00.000Z");
});

test("08: DBS PayNow sent — counterparty name masked by DBS itself", () => {
  const email = loadSample("08-dbs-paynow-sent.txt", new Date(Date.UTC(2026, 6, 4)));
  const { bank, transaction } = dispatch(email);
  assert.equal(bank, "DBS");
  assert.ok(transaction);
  assert.equal(transaction.direction, "debit");
  assert.equal(transaction.amountCents, 3000);
  assert.equal(transaction.accountIdentifier, "XXXX");
  assert.equal(transaction.occurredAt.toISOString(), "2026-07-04T14:21:00.000Z");
});

test("09: Citibank foreign-currency (JPY) card charge — no SGD figure in email", () => {
  const email = loadSample("09-citi-card-fx-spend.txt", new Date(Date.UTC(2026, 3, 20)));
  const { bank, transaction } = dispatch(email);
  assert.equal(bank, "Citibank");
  assert.ok(transaction);
  assert.equal(transaction.direction, "debit");
  assert.equal(transaction.currency, "JPY");
  assert.equal(transaction.amountCents, 10208000);
  assert.equal(transaction.merchantRaw, "BKG*Hakoneji Kaiun Amsterdam NLD");
  assert.equal(transaction.accountIdentifier, "XXXX");
  assert.equal(transaction.occurredAt.toISOString(), "2026-04-19T21:38:23.000Z");
});

test("10: Trust overseas spend (CNY, distinct word order from domestic)", () => {
  const email = loadSample("10-trust-overseas-spend.txt", new Date(Date.UTC(2026, 7, 19)));
  const { bank, transaction } = dispatch(email);
  assert.equal(bank, "Trust");
  assert.ok(transaction);
  assert.equal(transaction.direction, "debit");
  assert.equal(transaction.currency, "CNY");
  assert.equal(transaction.amountCents, 102588);
  assert.equal(transaction.merchantRaw, "WEIXIN*Shanghai Pala ShenZhen CN");
  assert.equal(transaction.accountIdentifier, "Freedom");
  assert.equal(transaction.occurredAt.toISOString(), "2026-08-19T02:01:00.000Z");
});
