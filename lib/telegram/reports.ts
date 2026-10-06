// Operational reporting only. The daily/weekly/monthly category spend
// summaries (FR-13/14, /today, /week, /month, /partner and the cron's
// monthly report) were removed in the Amex-only pivot — the bot is now a
// benefit tracker, not a general spend tracker. What's left is /pending's
// backlog view, which is pipeline health, not a spend summary.

import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { transactions, unclassifiedEmails } from "../schema";
import { formatSgtDateTime } from "../sgt";

export function fmtSgd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
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
