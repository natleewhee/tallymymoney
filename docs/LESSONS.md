# Lessons — debugging incidents worth not repeating

A running log. Not a design doc — each entry is a specific mistake made while building or debugging this project, recorded so the same shape of mistake doesn't happen again. Append, don't rewrite history.

---

## 2026-08-20: every Telegram command silently did nothing

**Symptom:** `/today`, `/week`, `/pending`, `/rules` — every slash command — produced no reply at all. No error, no message, nothing. Outgoing transaction notifications (new-transaction alerts, triage pings) worked fine the whole time. Button taps (category picker, Reduce, Needs parser) also worked fine the whole time.

**What actually was wrong:** `bot.on("message:text", ...)` — the handler for replying to a transaction message to amend its amount or description (FR-11/FR-22) — was registered *before* every `bot.command(...)` handler in `lib/telegram/bot.ts`. grammY runs middleware in registration order. Every slash command is also a plain text message. The handler checked whether the incoming message was a reply to something, and if not, `return`ed — without calling `next()`. That silently ends processing for that update. Since every command is a non-reply text message, **every command was being intercepted and dropped by this handler**, before ever reaching `/today`, `/week`, or anything else. The handler's own comment already stated the intent — *"not a reply — command handlers below cover the rest"* — the code just never actually called `next()` to make that true.

This had nothing to do with `TELEGRAM_CHAT_ID`, Vercel, environment variables, or deployments. It had been there since the bot was first built.

**What I actually did, in order, and why each step was a mistake:**

1. Saw the pattern "outgoing works, incoming doesn't" and diagnosed it as a `TELEGRAM_CHAT_ID` mismatch — plausible, but only one of at least two equally-consistent explanations. I didn't write down the alternative (a middleware bug swallowing incoming updates before they're processed) before committing to a fix. **Lesson: when a symptom has more than one plausible cause, say so and pick the cheapest test that distinguishes them, before writing a fix for either.**
2. Shipped four separate fixes in a row — trimming the env var, adding a log line, replying with a diagnostic, then a full temporary bypass — all aimed at the exact same comparison. Each one failed to change anything. **Lesson: one failed fix can be a bad fix. Two is a coincidence. Three or more aimed at the same target means the diagnosis itself is wrong — stop patching the theory and re-derive it from scratch.**
3. Relied on the user relaying Vercel's dashboard back as pasted text/screenshots for most of the investigation, which repeatedly didn't contain the evidence actually needed (runtime console output). **Lesson: when a fix depends on evidence that has to be manually found and relayed by someone else, and it isn't turning up after one or two tries, switch to a self-contained test instead of asking for the same kind of evidence again.**
4. The two moves that actually worked: (a) adding `/whoami`, a tiny new command placed early enough in the file to accidentally dodge the real bug, which gave one clean, unambiguous data point (the chat IDs matched exactly); and (b) once that ruled out the chat_id theory entirely, reading grammY's own source (`node_modules/grammy`) directly to understand its actual middleware/`Composer` execution order, instead of continuing to speculate about infrastructure. **Lesson: for a "some things work, some don't" pattern inside a middleware/framework-based system, checking the framework's actual control-flow semantics against source is often faster and more conclusive than debugging the deployment or environment around it — reach for it earlier, not as a last resort.**

**The fix:** `lib/telegram/bot.ts` — the handler now takes `next` and calls it before returning when the message isn't a reply, so command handlers registered after it actually get a turn.
