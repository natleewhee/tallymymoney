// The app can never touch Gmail directly — only the Apps Script running
// inside the dedicated inbox can. So both directions of the "needs
// parser" label are handled the same way: the app records an intention,
// Apps Script polls for it on its next 5-minute run, acts on Gmail, and
// acks. See app/api/needs-parser-queue/route.ts and
// apps-script/forward-to-ingest.gs.

import { isNull } from "drizzle-orm";
import { db } from "./db";
import { gmailLabelRemovals } from "./schema";

/** Queues the "needs parser" label to be taken back off a Gmail thread,
 * once that email is no longer stuck.
 *
 * Safe to call more than once for the same message: the unique
 * constraint on email_message_id makes a repeat a no-op rather than
 * queueing duplicate work. Never throws — an unlabelled thread is
 * cosmetic, and must not be able to fail the recovery or triage
 * operation that triggered it. */
export async function queueLabelRemoval(emailMessageId: string): Promise<void> {
  try {
    await db
      .insert(gmailLabelRemovals)
      .values({ emailMessageId })
      .onConflictDoNothing({ target: gmailLabelRemovals.emailMessageId });
  } catch (err) {
    console.error(`could not queue label removal for ${emailMessageId}`, err);
  }
}

/** Messages still carrying the label that shouldn't. */
export async function pendingLabelRemovals(): Promise<
  { id: number; emailMessageId: string }[]
> {
  return db
    .select({
      id: gmailLabelRemovals.id,
      emailMessageId: gmailLabelRemovals.emailMessageId,
    })
    .from(gmailLabelRemovals)
    .where(isNull(gmailLabelRemovals.removedAt));
}
