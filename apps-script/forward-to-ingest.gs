/**
 * TallyMyMoney — Gmail-side forwarder.
 *
 * Runs inside the DEDICATED inbox (nattytallymonny@gmail.com), never
 * Nat's real inbox. Reads unprocessed threads, POSTs each message to
 * /api/ingest, labels the thread once every message in it succeeds.
 * See docs/ARCHITECTURE.md "Apps Script (dedicated account)".
 *
 * Setup, done once inside the DEDICATED account:
 *   1. Log into nattytallymonny@gmail.com, open script.google.com,
 *      create a new project, paste this whole file in as Code.gs.
 *   2. Project Settings (gear icon) -> Script Properties -> add:
 *        INGEST_URL     = https://<your-vercel-domain>/api/ingest
 *        INGEST_SECRET  = <same value as Vercel's INGEST_SECRET env var>
 *   3. Triggers (clock icon, left sidebar) -> Add Trigger ->
 *        Function to run: pollInbox
 *        Event source: Time-driven
 *        Type: Minutes timer -> Every 5 minutes
 *   4. Run pollInbox once manually first, to grant Gmail + URL Fetch
 *      permissions — the trigger won't prompt for these on its own.
 */

var PROCESSED_LABEL = "tallymymoney-processed";

function pollInbox() {
  var props = PropertiesService.getScriptProperties();
  var ingestUrl = props.getProperty("INGEST_URL");
  var ingestSecret = props.getProperty("INGEST_SECRET");
  if (!ingestUrl || !ingestSecret) {
    throw new Error("Set INGEST_URL and INGEST_SECRET in Script Properties first.");
  }

  var label = GmailApp.getUserLabelByName(PROCESSED_LABEL) || GmailApp.createLabel(PROCESSED_LABEL);

  // No inbox restriction: this account exists solely to receive bank
  // alerts, so searching everything without the processed label is both
  // simpler and more robust than trusting inbox/archive state.
  var threads = GmailApp.search("-label:" + PROCESSED_LABEL, 0, 50);

  threads.forEach(function (thread) {
    var messages = thread.getMessages();
    var allOk = true;

    messages.forEach(function (message) {
      var payload = {
        messageId: message.getId(),
        from: message.getFrom(),
        subject: message.getSubject(),
        textBody: message.getPlainBody(),
        htmlBody: message.getBody(),
        receivedAt: message.getDate().toISOString(),
      };

      var response;
      try {
        response = UrlFetchApp.fetch(ingestUrl, {
          method: "post",
          contentType: "application/json",
          headers: { "x-ingest-secret": ingestSecret },
          payload: JSON.stringify(payload),
          muteHttpExceptions: true,
        });
      } catch (err) {
        Logger.log("Fetch failed for message " + message.getId() + ": " + err);
        allOk = false;
        return;
      }

      var code = response.getResponseCode();
      if (code < 200 || code >= 300) {
        Logger.log("Ingest returned " + code + " for message " + message.getId() + ": " + response.getContentText());
        allOk = false;
      }
    });

    // Only mark the thread processed once every message in it succeeded —
    // a partial failure retries the whole thread next run rather than
    // silently dropping half of it.
    if (allOk) {
      thread.addLabel(label);
    }
  });
}
