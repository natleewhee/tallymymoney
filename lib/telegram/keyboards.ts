import { InlineKeyboard } from "grammy";
import { CATEGORIES } from "../categories";

/** Item 16: encodes the category name directly rather than its index
 * into CATEGORIES. callback_data lives in Telegram message history
 * indefinitely, so an index-encoded button sitting un-tapped in old chat
 * history would silently resolve to a different category the moment
 * CATEGORIES is reordered. Names are well within Telegram's 64-byte
 * callback_data limit even for the longest one here. */
export function categoryKeyboard(txId: number): InlineKeyboard {
  const kb = new InlineKeyboard();
  CATEGORIES.forEach((cat, i) => {
    kb.text(cat, `c:${txId}:${cat}`);
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
 * "ignore" or "needs_parser" rule from the bot instead of raw SQL.
 *
 * Each button carries a short hash of that rule's (sender, subject) —
 * NOT its position in the listing. sender_rules has no surrogate key and
 * created_at defaults to now(), which in Postgres is transaction start
 * time, so rules created in one request tie exactly. An ORDER BY with
 * tied values has no guaranteed order, so a positional index could
 * resolve to a different, real rule on tap and delete it silently. A
 * wrongly-surviving "ignore" rule blocks a whole bank's alerts, so this
 * is worth the extra indirection. Hash rather than the raw pair because
 * Telegram caps callback_data at 64 bytes and a real sender+subject
 * exceeds that. */
export function rulesKeyboard(rules: { key: string; label: string }[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const rule of rules) {
    kb.text(`🗑 Clear ${rule.label}`, `rc:${rule.key}`).row();
  }
  return kb;
}

/** /partner: logs a settlement for the current calendar month. Always
 * "the current month" rather than an encoded period — /partner never
 * offers a past month to settle, so there's nothing to disambiguate. */
export function partnerSettleKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("✅ Mark settled this month", "ps");
}
