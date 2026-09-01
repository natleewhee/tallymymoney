// FR-13/14/15: on-demand and monthly reports. Every report states its own
// incompleteness — untagged, unparsed (pending-parser patterns), and
// unconfirmed FX estimates — per FR-15. A report that hides its own gaps
// is worse than no report; see STRATEGY.md §5 design principle.

import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { transactions, unclassifiedEmails } from "../schema";
import { formatSgtDateTime } from "../sgt";

export function fmtSgd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

/** Signed delta with an explicit +/- — fmtSgd's sign only ever shows for
 * negative, which reads fine for a total but is ambiguous for a
 * comparison ("$120.00" bigger or smaller than last month?). */
function fmtDelta(cents: number): string {
  if (cents === 0) return "$0.00";
  return cents > 0 ? `+${fmtSgd(cents)}` : `-${fmtSgd(Math.abs(cents))}`;
}

export interface RangeSummary {
  /** Debit spend minus standalone credits (refunds/PayNow-in not routed
   * through Reduce) — the net figure a report's headline total means. */
  total: number;
  /** Credits, shown separately so they aren't just a silent subtraction. */
  moneyIn: number;
  solo: number;
  joint: number;
  byCategory: Map<string, number>;
  uncategorizedTotal: number;
  untaggedCount: number;
  fxEstimatedCount: number;
  /** Rows with no real FX rate available at all (defect 11) — excluded
   * from every total above rather than summed at a 1:1 placeholder that
   * could be wrong by an unbounded factor. placeholderExcludedTotal is
   * what they'd have added, shown so the gap is visible, not silent. */
  placeholderCount: number;
  placeholderExcludedTotal: number;
  pendingParserCount: number;
  /** Non-ignored rows actually folded into the totals above — what the
   * "N transaction(s)" line should say, not the raw row count. */
  txCount: number;
  /** Same rows counted into txCount, kept individually — the monthly
   * markdown export's transaction list, so it reconciles exactly with
   * the totals above rather than coming from a second query. */
  lines: TransactionLine[];
}

export interface TransactionLine {
  id: number;
  occurredAt: Date;
  bank: string;
  merchantRaw: string | null;
  category: string | null;
  split: string | null;
  direction: "debit" | "credit";
  /** Net signed amount, same convention as RangeSummary.total: debit
   * positive, credit negative. */
  signedAmountCents: number;
}

/** Shared aggregation behind every report and behind /partner's
 * settle-up figure, so "this month's joint total" always means the same
 * thing wherever it's computed. */
export async function computeRangeSummary(start: Date, end: Date): Promise<RangeSummary> {
  const rows = await db
    .select()
    .from(transactions)
    .where(
      and(
        gte(transactions.occurredAt, start),
        lt(transactions.occurredAt, end),
        // Exclude rows that only exist to reduce another transaction —
        // they're folded into the parent's net total, not counted twice.
        sql`${transactions.reducesTransactionId} IS NULL`,
      ),
    );

  const [{ count: pendingParserCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(unclassifiedEmails)
    .where(eq(unclassifiedEmails.status, "needs_parser"));

  // Net each row against anything that reduces it.
  const reductions = await db
    .select({
      target: transactions.reducesTransactionId,
      amount: transactions.sgdAmountCents,
    })
    .from(transactions)
    .where(sql`${transactions.reducesTransactionId} IS NOT NULL`);
  const reductionByTarget = new Map<number, number>();
  for (const r of reductions) {
    if (r.target === null) continue;
    reductionByTarget.set(r.target, (reductionByTarget.get(r.target) ?? 0) + r.amount);
  }

  let total = 0;
  let moneyIn = 0;
  let solo = 0;
  let joint = 0;
  let untaggedCount = 0;
  let fxEstimatedCount = 0;
  let placeholderCount = 0;
  let placeholderExcludedTotal = 0;
  let txCount = 0;
  let uncategorizedTotal = 0;
  const byCategory = new Map<string, number>();
  const lines: TransactionLine[] = [];

  for (const t of rows) {
    if (t.status === "ignored") continue;

    const net = t.sgdAmountCents - (reductionByTarget.get(t.id) ?? 0);
    // A credit not routed through Reduce (a standalone refund, a PayNow
    // repayment) still means less was actually spent — defect 4:
    // previously these were read and counted but contributed nothing,
    // so the total silently overstated spend.
    const signed = t.direction === "debit" ? net : -net;

    // Defect 11: no real rate was available for this one, so sgd_amount_cents
    // is a 1:1 placeholder, not a conversion — could be off by an unbounded
    // factor for a weak currency. Excluded entirely rather than summed as
    // if it were real; declared via placeholderCount/placeholderExcludedTotal
    // instead.
    if (t.fxSource === "placeholder") {
      placeholderCount += 1;
      placeholderExcludedTotal += signed;
      continue;
    }

    txCount += 1;
    if (t.direction === "credit") moneyIn += net;

    total += signed;
    if (t.split === "solo") solo += signed;
    if (t.split === "joint") joint += signed;

    if (!t.category) {
      untaggedCount += 1;
      uncategorizedTotal += signed;
    } else {
      byCategory.set(t.category, (byCategory.get(t.category) ?? 0) + signed);
    }

    if (t.fxSource === "spot_estimate") fxEstimatedCount += 1;

    lines.push({
      id: t.id,
      occurredAt: t.occurredAt,
      bank: t.bank,
      merchantRaw: t.merchantRaw,
      category: t.category,
      split: t.split,
      // DB column is a plain text with a check constraint (schema.ts),
      // not a narrowed type — the constraint is the guarantee here.
      direction: t.direction as "debit" | "credit",
      signedAmountCents: signed,
    });
  }

  return {
    total,
    moneyIn,
    solo,
    joint,
    byCategory,
    uncategorizedTotal,
    untaggedCount,
    fxEstimatedCount,
    placeholderCount,
    placeholderExcludedTotal,
    pendingParserCount,
    txCount,
    lines,
  };
}

export interface ComparisonPeriod {
  label: string;
  total: number;
}

export async function formatRangeReport(
  title: string,
  start: Date,
  end: Date,
  comparison?: ComparisonPeriod,
): Promise<string> {
  const s = await computeRangeSummary(start, end);

  if (s.txCount === 0) {
    const lines = [`📊 ${title.toUpperCase()}`, "", "No transactions."];
    if (comparison) lines.push(`📈 vs ${comparison.label}: ${fmtSgd(s.total)} vs ${fmtSgd(comparison.total)}`);
    if (s.placeholderCount > 0) {
      lines.push(`🚫 ${s.placeholderCount} excluded — no FX rate available (≈${fmtSgd(s.placeholderExcludedTotal)} not counted) — see /estimates`);
    }
    if (s.pendingParserCount > 0) {
      lines.push(`⚠️ ${s.pendingParserCount} email pattern(s) still awaiting a parser — see /pending`);
    }
    return lines.join("\n");
  }

  const lines: string[] = [`📊 ${title.toUpperCase()}`, "", `💳 Total: ${fmtSgd(s.total)}`];
  if (comparison) {
    const delta = s.total - comparison.total;
    const pct = comparison.total !== 0 ? ` (${delta >= 0 ? "+" : ""}${Math.round((delta / comparison.total) * 100)}%)` : "";
    lines.push(`📈 vs ${comparison.label}: ${fmtDelta(delta)}${pct} — was ${fmtSgd(comparison.total)}`);
  }
  if (s.moneyIn > 0) lines.push(`💰 Money in: ${fmtSgd(s.moneyIn)} (already netted into total)`);
  if (s.solo || s.joint) {
    lines.push(`👤 Solo: ${fmtSgd(s.solo)}  ·  👥 Joint: ${fmtSgd(s.joint)}`);
  }
  if (s.byCategory.size > 0 || s.uncategorizedTotal !== 0) {
    lines.push("", "BY CATEGORY");
    for (const [cat, amt] of [...s.byCategory.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(`${cat}: ${fmtSgd(amt)}`);
    }
    if (s.uncategorizedTotal !== 0) lines.push(`Uncategorised: ${fmtSgd(s.uncategorizedTotal)}`);
  }

  lines.push("", `📈 ${s.txCount} transaction(s)`);
  if (s.untaggedCount > 0) lines.push(`⚠️ ${s.untaggedCount} untagged`);
  if (s.fxEstimatedCount > 0) lines.push(`⚠️ ${s.fxEstimatedCount} carrying an unconfirmed FX estimate — see /estimates`);
  if (s.placeholderCount > 0) {
    lines.push(`🚫 ${s.placeholderCount} excluded — no FX rate available (≈${fmtSgd(s.placeholderExcludedTotal)} not counted) — see /estimates`);
  }
  if (s.pendingParserCount > 0) lines.push(`⚠️ ${s.pendingParserCount} email pattern(s) awaiting a parser — see /pending`);

  return lines.join("\n");
}

function fmtDayTime(date: Date): string {
  // formatSgtDateTime renders "31 Aug 2026, 3:15 pm" — drop the year for
  // a compact table cell; the report title already states the month.
  return formatSgtDateTime(date).replace(/\d{4}, /, "");
}

/** Escapes markdown table cell content — pipes would otherwise break the
 * row, and bank-derived merchant strings routinely contain them (see
 * notify.ts's comment on the same class of character). */
function escCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/** The monthly report's detailed companion file — a full itemised
 * transaction list plus the same summary content as formatRangeReport,
 * built from the same computeRangeSummary() call so the file always
 * reconciles with the text message sent alongside it. */
export async function formatMonthlyMarkdown(
  title: string,
  start: Date,
  end: Date,
  comparison?: ComparisonPeriod,
): Promise<string> {
  const s = await computeRangeSummary(start, end);
  const out: string[] = [`# 📊 ${title}`, ""];

  out.push("## Summary", "");
  out.push(`- **Total:** ${fmtSgd(s.total)}`);
  if (comparison) {
    const delta = s.total - comparison.total;
    const pct = comparison.total !== 0 ? ` (${delta >= 0 ? "+" : ""}${Math.round((delta / comparison.total) * 100)}%)` : "";
    out.push(`- **vs ${comparison.label}:** ${fmtDelta(delta)}${pct} — was ${fmtSgd(comparison.total)}`);
  }
  if (s.moneyIn > 0) out.push(`- **Money in:** ${fmtSgd(s.moneyIn)} (already netted into total)`);
  if (s.solo || s.joint) out.push(`- **Solo:** ${fmtSgd(s.solo)}  ·  **Joint:** ${fmtSgd(s.joint)}`);
  out.push(`- **Transactions:** ${s.txCount}`, "");

  if (s.byCategory.size > 0 || s.uncategorizedTotal !== 0) {
    out.push("## By Category", "", "| Category | Amount |", "|---|---|");
    for (const [cat, amt] of [...s.byCategory.entries()].sort((a, b) => b[1] - a[1])) {
      out.push(`| ${escCell(cat)} | ${fmtSgd(amt)} |`);
    }
    if (s.uncategorizedTotal !== 0) out.push(`| Uncategorised | ${fmtSgd(s.uncategorizedTotal)} |`);
    out.push("");
  }

  const incompleteness: string[] = [];
  if (s.untaggedCount > 0) incompleteness.push(`${s.untaggedCount} untagged`);
  if (s.fxEstimatedCount > 0) incompleteness.push(`${s.fxEstimatedCount} carrying an unconfirmed FX estimate — see /estimates`);
  if (s.placeholderCount > 0) {
    incompleteness.push(`${s.placeholderCount} excluded — no FX rate available (≈${fmtSgd(s.placeholderExcludedTotal)} not counted) — see /estimates`);
  }
  if (s.pendingParserCount > 0) incompleteness.push(`${s.pendingParserCount} email pattern(s) awaiting a parser — see /pending`);
  if (incompleteness.length > 0) {
    out.push("## Incompleteness", "");
    for (const item of incompleteness) out.push(`- ${item}`);
    out.push("");
  }

  out.push(`## Transactions (${s.lines.length})`, "");
  if (s.lines.length === 0) {
    out.push("No transactions.");
  } else {
    out.push("| Date | Merchant | Amount | Category | Split | Bank |", "|---|---|---|---|---|---|");
    const sorted = [...s.lines].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    for (const t of sorted) {
      out.push(
        `| ${fmtDayTime(t.occurredAt)} | ${escCell(t.merchantRaw ?? "(none given)")} | ${fmtSgd(t.signedAmountCents)} | ${escCell(t.category ?? "Uncategorised")} | ${escCell(t.split ?? "—")} | ${escCell(t.bank)} |`,
      );
    }
  }

  return out.join("\n");
}

export async function formatPendingReport(): Promise<string> {
  const untagged = await db
    .select()
    .from(transactions)
    .where(eq(transactions.status, "pending"));

  const fxEstimates = await db
    .select()
    .from(transactions)
    .where(sql`${transactions.fxSource} IN ('spot_estimate','placeholder')`);

  const needsParser = await db
    .select()
    .from(unclassifiedEmails)
    .where(eq(unclassifiedEmails.status, "needs_parser"));

  const lines = ["📋 PENDING", ""];
  lines.push(`Untagged transactions: ${untagged.length}`);
  lines.push(`Unconfirmed FX estimates: ${fxEstimates.length}${fxEstimates.length > 0 ? " — see /estimates" : ""}`);
  lines.push(`Email patterns awaiting a parser: ${needsParser.length}`);

  if (untagged.length > 0) {
    lines.push("", "UNTAGGED");
    for (const t of untagged.slice(0, 10)) {
      lines.push(`#${t.id} — ${fmtSgd(t.sgdAmountCents)} ${t.merchantRaw ?? "(no merchant)"}`);
    }
  }

  // Previously this count had nowhere to point back to — "2 email
  // pattern(s) awaiting a parser" with no way to tell which two, so the
  // only lead was whatever Gmail label happened to still be showing (and
  // that label lags a 5-minute Apps Script poll on both ends, so it's
  // not reliable moment-to-moment either). Listing sender/subject/date
  // here means Nat can go straight to Gmail search for the exact thread
  // regardless of label state.
  if (needsParser.length > 0) {
    lines.push("", "NEEDS PARSER");
    for (const e of needsParser.slice(0, 10)) {
      lines.push(`#${e.id} — ${e.sender} — "${e.subject ?? "(no subject)"}" (${formatSgtDateTime(e.receivedAt)})`);
    }
  }

  return lines.join("\n");
}
