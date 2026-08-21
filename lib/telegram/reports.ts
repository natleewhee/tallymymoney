// FR-13/14/15: on-demand and monthly reports. Every report states its own
// incompleteness — untagged, unparsed (pending-parser patterns), and
// unconfirmed FX estimates — per FR-15. A report that hides its own gaps
// is worse than no report; see STRATEGY.md §5 design principle.

import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { transactions, unclassifiedEmails } from "../schema";

function fmtSgd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

export async function formatRangeReport(title: string, start: Date, end: Date): Promise<string> {
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

  if (rows.length === 0) {
    return `📊 ${title.toUpperCase()}\n\nNo transactions.${pendingParserCount > 0 ? `\n\n⚠️ ${pendingParserCount} email pattern(s) still awaiting a parser — see /pending` : ""}`;
  }

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
  let solo = 0;
  let joint = 0;
  let untagged = 0;
  let fxEstimated = 0;
  const byCategory = new Map<string, number>();

  for (const t of rows) {
    if (t.status === "ignored") continue;
    const net = t.sgdAmountCents - (reductionByTarget.get(t.id) ?? 0);
    if (t.direction === "debit") {
      total += net;
      if (t.split === "solo") solo += net;
      if (t.split === "joint") joint += net;
      if (!t.category) untagged += 1;
      if (t.category) byCategory.set(t.category, (byCategory.get(t.category) ?? 0) + net);
    }
    if (t.fxSource === "spot_estimate") fxEstimated += 1;
  }

  const lines: string[] = [`📊 ${title.toUpperCase()}`, "", `💳 Total: ${fmtSgd(total)}`];
  if (solo || joint) {
    lines.push(`👤 Solo: ${fmtSgd(solo)}  ·  👥 Joint: ${fmtSgd(joint)}`);
  }
  if (byCategory.size > 0) {
    lines.push("", "BY CATEGORY");
    for (const [cat, amt] of [...byCategory.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(`${cat}: ${fmtSgd(amt)}`);
    }
  }

  lines.push("", `📈 ${rows.length} transaction(s)`);
  if (untagged > 0) lines.push(`⚠️ ${untagged} untagged`);
  if (fxEstimated > 0) lines.push(`⚠️ ${fxEstimated} carrying an unconfirmed FX estimate — see /pending`);
  if (pendingParserCount > 0) lines.push(`⚠️ ${pendingParserCount} email pattern(s) awaiting a parser — see /pending`);

  return lines.join("\n");
}

export async function formatPendingReport(): Promise<string> {
  const untagged = await db
    .select()
    .from(transactions)
    .where(eq(transactions.status, "pending"));

  const fxEstimates = await db
    .select()
    .from(transactions)
    .where(eq(transactions.fxSource, "spot_estimate"));

  const needsParser = await db
    .select()
    .from(unclassifiedEmails)
    .where(eq(unclassifiedEmails.status, "needs_parser"));

  const lines = ["📋 PENDING", ""];
  lines.push(`Untagged transactions: ${untagged.length}`);
  lines.push(`Unconfirmed FX estimates: ${fxEstimates.length}`);
  lines.push(`Email patterns awaiting a parser: ${needsParser.length}`);

  if (untagged.length > 0) {
    lines.push("", "UNTAGGED");
    for (const t of untagged.slice(0, 10)) {
      lines.push(`#${t.id} — ${fmtSgd(t.sgdAmountCents)} ${t.merchantRaw ?? "(no merchant)"}`);
    }
  }

  return lines.join("\n");
}
