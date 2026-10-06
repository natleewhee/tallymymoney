// Pure-logic coverage for the Amex benefit tracker (lib/benefit-logic.ts):
// period bounds per cadence/anchor, pace check triggers, the low-confidence
// suggestion heuristic, and amount parsing. Everything DB-touching lives
// in lib/cards.ts and isn't exercised here (no test DB in this repo).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addMonthsSgt,
  daysLeft,
  fmtPeriod,
  matchesBenefitHeuristic,
  paceCheck,
  parseAmountCents,
  periodBounds,
  sgtDate,
} from "../lib/benefit-logic.ts";

const at = (iso: string) => new Date(iso);

test("periodBounds: semi_annual calendar splits Jan–Jun / Jul–Dec in SGT", () => {
  const { start, end } = periodBounds("semi_annual", "calendar", at("2026-10-05T04:00:00Z"));
  assert.equal(start.toISOString(), "2026-06-30T16:00:00.000Z"); // 1 Jul 00:00 SGT
  assert.equal(end.toISOString(), "2026-12-31T16:00:00.000Z"); // 1 Jan 00:00 SGT (exclusive)
  assert.equal(fmtPeriod(start, end), "1 Jul–31 Dec");
});

test("periodBounds: SGT, not UTC — 30 Jun 17:00 UTC is already 1 Jul in Singapore", () => {
  const { start } = periodBounds("semi_annual", "calendar", at("2026-06-30T17:00:00Z"));
  assert.equal(start.toISOString(), sgtDate(2026, 6, 1).toISOString());
});

test("periodBounds: bimonthly cycles are Jan–Feb, Mar–Apr, …, Sep–Oct", () => {
  const { start, end } = periodBounds("bimonthly", "calendar", at("2026-10-05T04:00:00Z"));
  assert.equal(start.toISOString(), sgtDate(2026, 8, 1).toISOString());
  assert.equal(end.toISOString(), sgtDate(2026, 10, 1).toISOString());
});

test("periodBounds: annual calendar is the calendar year", () => {
  const { start, end } = periodBounds("annual", "calendar", at("2026-03-02T00:00:00Z"));
  assert.equal(start.toISOString(), sgtDate(2026, 0, 1).toISOString());
  assert.equal(end.toISOString(), sgtDate(2027, 0, 1).toISOString());
});

test("periodBounds: cardmember_year runs anniversary to anniversary", () => {
  const renewalDate = sgtDate(2025, 8, 15); // 15 Sep 2025
  const before = periodBounds("annual", "cardmember_year", sgtDate(2026, 8, 14), { renewalDate });
  assert.equal(before.start.toISOString(), sgtDate(2025, 8, 15).toISOString());
  assert.equal(before.end.toISOString(), sgtDate(2026, 8, 15).toISOString());
  const on = periodBounds("annual", "cardmember_year", sgtDate(2026, 8, 15), { renewalDate });
  assert.equal(on.start.toISOString(), sgtDate(2026, 8, 15).toISOString());
});

test("periodBounds: cardmember_year with no renewal date falls back to calendar", () => {
  const { start } = periodBounds("annual", "cardmember_year", at("2026-10-05T04:00:00Z"), { renewalDate: null });
  assert.equal(start.toISOString(), sgtDate(2026, 0, 1).toISOString());
});

test("periodBounds: one_time is a single open-ended period", () => {
  const createdAt = at("2026-10-01T02:00:00Z");
  const a = periodBounds("one_time", "calendar", at("2026-10-05T00:00:00Z"), { createdAt });
  const b = periodBounds("one_time", "calendar", at("2030-01-01T00:00:00Z"), { createdAt });
  assert.equal(a.start.toISOString(), b.start.toISOString());
  assert.ok(a.end.getUTCFullYear() >= 2099);
});

test("addMonthsSgt clamps the day (31 Aug + 6 months → 28 Feb)", () => {
  assert.equal(addMonthsSgt(sgtDate(2026, 7, 31), 6).toISOString(), sgtDate(2027, 1, 28).toISOString());
});

test("daysLeft rounds up: a period ending at tonight's SGT midnight has 1 day left", () => {
  assert.equal(daysLeft(sgtDate(2026, 9, 6), at("2026-10-05T04:00:00Z")), 1);
});

test("paceCheck: on pace → not behind", () => {
  const start = sgtDate(2026, 0, 1);
  const end = sgtDate(2026, 6, 1);
  const mid = new Date((start.getTime() + end.getTime()) / 2);
  const r = paceCheck(550_000, 1_000_000, start, end, mid, 1_000_000);
  assert.equal(r.behind, false);
});

test("paceCheck: >15 points behind the clock → behind", () => {
  const start = sgtDate(2026, 0, 1);
  const end = sgtDate(2026, 6, 1);
  const mid = new Date((start.getTime() + end.getTime()) / 2);
  const r = paceCheck(200_000, 1_000_000, start, end, mid, 10_000_000);
  assert.equal(r.behind, true);
  assert.match(r.reason!, /spent vs/);
});

test("paceCheck: required weekly spend above typical → behind even if % gap is small", () => {
  const start = sgtDate(2026, 0, 1);
  const end = sgtDate(2026, 6, 1);
  const early = sgtDate(2026, 0, 8);
  const r = paceCheck(0, 1_000_000, start, end, early, 20_000);
  assert.equal(r.behind, true);
  assert.match(r.reason!, /week/);
});

test("paceCheck: met target is never behind", () => {
  const r = paceCheck(1_000_000, 1_000_000, sgtDate(2026, 0, 1), sgtDate(2026, 6, 1), sgtDate(2026, 5, 20));
  assert.equal(r.behind, false);
});

test("matchesBenefitHeuristic: SIA >= S$300 SGD suggests Airline Credit; small or foreign does not", () => {
  assert.equal(matchesBenefitHeuristic("Airline Credit", { merchantRaw: "SINGAPORE AIRLINES LTD", currency: "SGD", sgdAmountCents: 45_000 }), true);
  assert.equal(matchesBenefitHeuristic("Airline Credit", { merchantRaw: "SCOOT TIGERAIR", currency: "SGD", sgdAmountCents: 30_000 }), true);
  assert.equal(matchesBenefitHeuristic("Airline Credit", { merchantRaw: "SINGAPORE AIRLINES LTD", currency: "SGD", sgdAmountCents: 29_999 }), false);
  assert.equal(matchesBenefitHeuristic("Airline Credit", { merchantRaw: "GRAB", currency: "SGD", sgdAmountCents: 50_000 }), false);
});

test("matchesBenefitHeuristic: Vivino → Wine Credit; foreign >= S$300 → Global Dining", () => {
  assert.equal(matchesBenefitHeuristic("Platinum Wine Credit", { merchantRaw: "VIVINO SG", currency: "SGD", sgdAmountCents: 31_000 }), true);
  assert.equal(matchesBenefitHeuristic("Global Dining Credit", { merchantRaw: "SUSHI SAITO", currency: "JPY", sgdAmountCents: 40_000 }), true);
  assert.equal(matchesBenefitHeuristic("Global Dining Credit", { merchantRaw: "SUSHI SAITO", currency: "SGD", sgdAmountCents: 40_000 }), false);
  assert.equal(matchesBenefitHeuristic("Table for Two", { merchantRaw: "ANY", currency: "SGD", sgdAmountCents: 99_999 }), false);
});

test("parseAmountCents", () => {
  assert.equal(parseAmountCents("200"), 20_000);
  assert.equal(parseAmountCents("S$1,200.50"), 120_050);
  assert.equal(parseAmountCents("$45"), 4_500);
  assert.equal(parseAmountCents("abc"), null);
  assert.equal(parseAmountCents("0"), null);
});
