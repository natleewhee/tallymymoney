import { InlineKeyboard } from "grammy";
import { CATEGORIES } from "../categories";

export function categoryKeyboard(txId: number): InlineKeyboard {
  const kb = new InlineKeyboard();
  CATEGORIES.forEach((cat, i) => {
    kb.text(cat, `c:${txId}:${i}`);
    if (i % 2 === 1) kb.row();
  });
  return kb;
}

export function splitKeyboard(txId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("👤 Solo", `s:${txId}:solo`)
    .text("👥 Joint", `s:${txId}:joint`);
}

/** FR-7: known merchant — one tap to confirm the pre-filled category/split,
 * one tap to override into the full picker (FR-8). */
export function confirmOrOverrideKeyboard(txId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Confirm", `cf:${txId}`)
    .text("✏️ Change", `ov:${txId}`)
    .row()
    .text("🚫 Ignore", `i:${txId}`)
    .text("↩️ Reduce", `r:${txId}`);
}

/** FR-8: unknown merchant — category buttons first (drives merchant
 * memory), plus Ignore/Reduce for the cases that aren't a new expense
 * at all. */
export function newTransactionKeyboard(txId: number): InlineKeyboard {
  const kb = categoryKeyboard(txId);
  kb.row().text("🚫 Ignore", `i:${txId}`).text("↩️ Reduce", `r:${txId}`);
  return kb;
}

export function reduceCandidatesKeyboard(
  sourceTxId: number,
  candidates: { id: number; label: string }[],
): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const c of candidates) {
    kb.text(c.label, `rt:${sourceTxId}:${c.id}`).row();
  }
  kb.text("Cancel", `cancel:${sourceTxId}`);
  return kb;
}

export function triageKeyboard(unclassifiedId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("🚫 Ignore this type", `ti:${unclassifiedId}`)
    .text("🔧 Needs parser", `tn:${unclassifiedId}`);
}

/** /pending: the two recovery actions — re-send alerts that never made it
 * out, and re-run the current parsers over the stuck backlog. See
 * lib/recovery.ts for why neither happens automatically. */
export function pendingKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🔄 Re-send missed alerts", "resend")
    .row()
    .text("🔁 Retry stuck emails", "reparse");
}

/** /rules: one "Clear" button per active sender_rule, so Nat can undo an
 * "ignore" or "needs_parser" rule from the bot instead of raw SQL. Index
 * is positional within that message's listing, not a DB id — sender_rules
 * has no surrogate key, and re-querying by the same order on tap is fine
 * for a single-user tool. */
export function rulesKeyboard(count: number): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (let i = 0; i < count; i++) {
    kb.text(`🗑 Clear #${i}`, `rc:${i}`).row();
  }
  return kb;
}
