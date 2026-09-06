// Holiday mode: while a holiday is active, every transaction that
// arrives (arrival semantics — see schema.ts's comment on
// transactions.holidayId) gets stamped with it, on top of its normal
// category. This module owns the holiday lifecycle (start/end),
// resolving a name/id reference for /holiday tag, and the pinned
// "still on holiday" banner. Aggregation (computing a holiday's total
// spend) lives in lib/telegram/reports.ts alongside computeRangeSummary,
// since both share the same per-row summing logic.

import { desc, eq, isNull } from "drizzle-orm";
import { db } from "./db";
import { holidays, transactions, type Holiday } from "./schema";
import { bot } from "./telegram/bot";
import { computeHolidaySummary, fmtSgd, type RangeSummary } from "./telegram/reports";
import { isUniqueViolation } from "./db-utils";

export async function getActiveHoliday(): Promise<Holiday | undefined> {
  // idx_holidays_one_active (schema.ts) guarantees at most one row can
  // ever match, but ORDER BY + LIMIT keeps this deterministic even
  // against a database where that migration hasn't run yet.
  const [row] = await db
    .select()
    .from(holidays)
    .where(isNull(holidays.endedAt))
    .orderBy(desc(holidays.startedAt))
    .limit(1);
  return row;
}

export async function getActiveHolidayId(): Promise<number | null> {
  const active = await getActiveHoliday();
  return active?.id ?? null;
}

export async function listHolidays(): Promise<Holiday[]> {
  return db.select().from(holidays).orderBy(desc(holidays.startedAt));
}

/** Finds a holiday by numeric id or a case-insensitive substring of its
 * name (most recent match first). Used by /holiday tag when no holiday
 * is active and the caller names one explicitly. Returns "ambiguous"
 * with every match when more than one name matches, so the caller can
 * ask Nat to disambiguate by id rather than silently picking one. */
export async function resolveHolidayRef(
  ref: string,
): Promise<{ kind: "found"; holiday: Holiday } | { kind: "ambiguous"; matches: Holiday[] } | { kind: "not-found" }> {
  const trimmed = ref.trim();
  const asId = /^\d+$/.test(trimmed) ? Number(trimmed) : null;
  if (asId !== null) {
    const [row] = await db.select().from(holidays).where(eq(holidays.id, asId));
    return row ? { kind: "found", holiday: row } : { kind: "not-found" };
  }

  const all = await listHolidays();
  const matches = all.filter((h) => h.name.toLowerCase().includes(trimmed.toLowerCase()));
  if (matches.length === 0) return { kind: "not-found" };
  if (matches.length === 1) return { kind: "found", holiday: matches[0] };
  return { kind: "ambiguous", matches };
}

/** Returns null if idx_holidays_one_active (schema.ts) rejected the
 * insert — a holiday became active between the caller's own
 * getActiveHoliday() check and this call (a retried webhook delivery, or
 * two /holiday start taps close together). The DB constraint is the real
 * guard; this only turns its rejection into a normal "no" instead of an
 * uncaught 23505 reaching bot.catch. */
export async function startHoliday(name: string): Promise<Holiday | null> {
  try {
    const [row] = await db.insert(holidays).values({ name }).returning();
    return row;
  } catch (err) {
    if (isUniqueViolation(err)) return null;
    throw err;
  }
}

/** Ends the active holiday, if any. Does not touch the pinned message —
 * the caller (bot.ts) edits it to a final summary and unpins it, since
 * that needs the chat/message ids this function has no reason to know
 * about beyond what's already stored on the row it returns. */
export async function endActiveHoliday(): Promise<Holiday | undefined> {
  const active = await getActiveHoliday();
  if (!active) return undefined;
  const [row] = await db
    .update(holidays)
    .set({ endedAt: new Date() })
    .where(eq(holidays.id, active.id))
    .returning();
  return row;
}

export async function recordPin(holidayId: number, chatId: string, messageId: number): Promise<void> {
  await db
    .update(holidays)
    .set({ pinnedChatId: chatId, pinnedMessageId: messageId })
    .where(eq(holidays.id, holidayId));
}

/** Sets or clears a transaction's holiday tag. Returns the updated row's
 * id, or null if txId doesn't exist — same "not found" contract as the
 * bot's other by-id lookups (see the "c" callback's .returning() check). */
export async function tagTransactionHoliday(txId: number, holidayId: number | null): Promise<number | null> {
  const [row] = await db
    .update(transactions)
    .set({ holidayId })
    .where(eq(transactions.id, txId))
    .returning({ id: transactions.id });
  return row?.id ?? null;
}

export function dayCount(startedAt: Date, asOf: Date): number {
  const ms = asOf.getTime() - startedAt.getTime();
  return Math.max(1, Math.floor(ms / (24 * 60 * 60 * 1000)) + 1);
}

/** `summary` is optional so a caller that's about to compute it anyway
 * for something else (e.g. /holiday end's final report) can pass it in
 * rather than paying for computeHolidaySummary's query twice in one
 * command. */
async function bannerText(holiday: Holiday, asOf: Date, summary?: RangeSummary): Promise<string> {
  const s = summary ?? (await computeHolidaySummary(holiday.id));
  const day = dayCount(holiday.startedAt, asOf);
  return holiday.endedAt
    ? `✅ 🌴 ${holiday.name} — ${day} day(s), ${fmtSgd(s.total)} total`
    : `🌴 ${holiday.name} — Day ${day} · ${fmtSgd(s.total)} so far`;
}

/** If Telegram says the pinned message itself is gone (the user deleted
 * it, or unpinned and then deleted it), clears the stored ids so future
 * refreshes stop silently retrying against a message that will never
 * exist again. Without this, a deleted pin left every subsequent ingest/
 * tag/untag logging the same failure forever with no way to recover
 * short of a fresh /holiday start. Returns true if it recognised and
 * handled that case. Heuristic string match on Telegram's error text —
 * grammY doesn't expose a typed "message not found" error code, and this
 * covers both edit and pin/unpin failures. */
async function clearPinIfMessageGone(holidayId: number, err: unknown): Promise<boolean> {
  const message = err instanceof Error ? err.message : String(err);
  if (!/message to (?:edit|pin|delete) not found|message_id_invalid/i.test(message)) return false;
  await db.update(holidays).set({ pinnedChatId: null, pinnedMessageId: null }).where(eq(holidays.id, holidayId));
  return true;
}

/** Best-effort: edits the pinned banner in place so it stays current as
 * spend comes in. Called after any insert/tag/untag that touches the
 * active holiday's total. Never thrown from a caller's main path — same
 * "recoverable, not fatal" treatment as every other Telegram send in
 * this codebase (ingest's notify calls, notify.ts itself). */
export async function refreshHolidayBanner(holidayId: number): Promise<void> {
  const [holiday] = await db.select().from(holidays).where(eq(holidays.id, holidayId));
  if (!holiday || !holiday.pinnedChatId || !holiday.pinnedMessageId) return;
  try {
    const text = await bannerText(holiday, new Date());
    await bot.api.editMessageText(holiday.pinnedChatId, holiday.pinnedMessageId, text);
  } catch (err) {
    // Telegram 400s on "message is not modified" when the text is
    // unchanged since the last edit — not a real failure, just noisy.
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("message is not modified")) return;
    if (await clearPinIfMessageGone(holidayId, err)) {
      console.error(`holiday #${holidayId}'s pinned banner was deleted — cleared so future refreshes stop retrying; see /holiday status`, err);
      return;
    }
    console.error(`could not refresh holiday banner for #${holidayId}`, err);
  }
}

export { clearPinIfMessageGone };

export { bannerText as formatHolidayBannerText };
