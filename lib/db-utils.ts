import { timingSafeEqual } from "node:crypto";

/** True if `err` is Postgres' unique_violation (23505) — the signal a
 * caller uses to distinguish "this row already exists" from a real
 * failure, e.g. a duplicate email_message_id on retry. Shared rather than
 * redefined per call site (item 19: recovery.ts needs the same check). */
export function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string } | undefined)?.code;
  return code === "23505";
}

/** Constant-time secret comparison for the ingest webhook auth header.
 * Plain `===` short-circuits on the first mismatched byte, leaking a
 * timing signal about how much of the secret a guess got right. */
export function secretsMatch(provided: string | null, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
