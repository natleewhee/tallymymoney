/** True if `err` is Postgres' unique_violation (23505) — the signal a
 * caller uses to distinguish "this row already exists" from a real
 * failure, e.g. a duplicate email_message_id on retry. Shared rather than
 * redefined per call site (item 19: recovery.ts needs the same check). */
export function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string } | undefined)?.code;
  return code === "23505";
}
