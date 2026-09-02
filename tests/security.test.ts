// Regression coverage for the two ce-code-review security fixes:
// timing-safe ingest-secret comparison and CSV-formula-injection
// guarding on export. Both previously had zero test coverage.

import { test } from "node:test";
import assert from "node:assert/strict";
import { secretsMatch } from "../lib/db-utils.ts";
import { csvField } from "../lib/csv.ts";

test("csvField: plain values pass through unquoted", () => {
  assert.equal(csvField("TOKU NORI"), "TOKU NORI");
  assert.equal(csvField(149.9), "149.9");
});

test("csvField: RFC 4180 quoting for commas/quotes/newlines", () => {
  assert.equal(csvField('Ah, "Toku" Nori'), '"Ah, ""Toku"" Nori"');
  assert.equal(csvField("line1\nline2"), '"line1\nline2"');
});

test("csvField: neutralises formula-triggering leading characters (CSV injection)", () => {
  assert.equal(csvField('=HYPERLINK("http://evil","x")'), '"\'=HYPERLINK(""http://evil"",""x"")"');
  assert.equal(csvField("+1234"), "'+1234");
  assert.equal(csvField("-1234 SOME MERCHANT"), "'-1234 SOME MERCHANT");
  assert.equal(csvField("@SUM(A1:A2)"), "'@SUM(A1:A2)");
});

test("csvField: a merchant name that merely contains one of the guarded characters mid-string is untouched", () => {
  assert.equal(csvField("Ben & Jerry's - Orchard"), "Ben & Jerry's - Orchard");
});

test("secretsMatch: equal secrets match", () => {
  assert.equal(secretsMatch("shh-its-a-secret", "shh-its-a-secret"), true);
});

test("secretsMatch: different secrets do not match", () => {
  assert.equal(secretsMatch("wrong", "shh-its-a-secret"), false);
});

test("secretsMatch: different-length inputs do not match (and don't throw)", () => {
  assert.equal(secretsMatch("short", "a-much-longer-secret"), false);
});

test("secretsMatch: missing header or unset env secret never matches", () => {
  assert.equal(secretsMatch(null, "shh-its-a-secret"), false);
  assert.equal(secretsMatch("shh-its-a-secret", undefined), false);
  assert.equal(secretsMatch(null, undefined), false);
});
