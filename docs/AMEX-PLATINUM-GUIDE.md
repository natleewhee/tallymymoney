# Amex Platinum Charge Tracker — User Guide

This is the guide for using tallymymoney's `/benefits` tracker on your Amex Platinum Charge (Singapore, 2026 terms). It covers one-time setup, what the bot does automatically vs what you have to do yourself, and specific instructions for every benefit.

---

## 1. One-time setup

1. **Apply the migration:**
   ```
   node scripts/migrate-http.mjs
   ```
2. **Fill in the placeholders** at the top of `scripts/seed-amex-platinum.mjs`:
   - `ACCOUNT_LAST4` — the digits Amex quotes in its alert emails (usually 5 digits)
   - `APPROVAL_DATE` — the date your card was approved (`"YYYY-MM-DD"`). This anchors both welcome-bonus windows.
   - `RENEWAL_DATE` — your card's annual renewal date. This anchors the cardmember-year benefits (Paragon/Comoclub/Sands/Pan Pacific).
3. **Run the seed script once:**
   ```
   node scripts/seed-amex-platinum.mjs
   ```
4. **Narrow your Gmail forwarding** (outside this repo) so Apps Script only forwards Amex alert emails — this is what keeps you off your hosting quota.
5. Open Telegram and run `/benefits` — the board should render and a pinned status banner should appear.

---

## 2. How the bot works, in one page

- `/benefits` is the single place to check everything — it has three sections (dollar credits, cycle experiences, status & memberships).
- A **pinned message** in your chat always shows what's due in the next 14 days — expiring credits, open cycles about to close, challenge deadlines. You don't need to check `/benefits` daily; the pin tells you when something needs attention.
- When an Amex transaction comes in that *might* match a benefit (e.g. an SIA charge, a Vivino charge), the bot will ask `[Apply to X] [Not this one]`. **These are guesses — always double check.** The bot cannot see whether you paid via the right channel, whether a restaurant was on the participating list, or whether you'd "saved" the benefit first.
- `/usebenefit <name> [amount]` — manually mark a benefit used, any time, without waiting for a prompt.
- `/cardadjust [challenge] <+/-amount> [note]` — correct challenge progress by hand (e.g. a missed email, a refund that didn't register).
- **The Amex parser is unverified against a real email.** If a real Amex alert fails to parse, it'll show in Telegram as "COULDN'T READ THIS ONE — Bank: Amex" — forward that email so the parser can be fixed.

---

## 3. Per-benefit instructions

### Welcome bonus — Gift A: S$10,000 in 6 months
- **What it is:** Spend S$10,000 on eligible purchases within 6 months of approval → 100,000 bonus MR points (new-to-Amex) or 60,000 (existing Amex customer).
- **Tracked:** Automatically — the bot sums your Amex spend, minus excluded transactions (annual fee, cash advances), from approval date to the 6-month deadline.
- **What you do:** Nothing, day to day. Watch for the Monday pace-check nudge if you fall behind. Remember the deadline is effectively **~5 days earlier** than stated, since Amex counts *posted* transactions, not transactions made on the last day.
- **Gotcha:** If you return/cancel a purchase, it'll net out of your progress automatically — but it can also claw back points already awarded if it happens after the bonus posted.

### Welcome bonus — Gift B: S$1 in your 15th membership month
- **What it is:** A second, separate 100,000/60,000-point bonus for a trivial S$1 spend — but only during a **specific one-month window 14 months after approval**.
- **Tracked:** Automatically, same mechanism as Gift A, but watch for the reminder — this is the one most people forget about since it's 14 months after the excitement of signing up.
- **What you do:** Just make sure you make *any* Amex purchase during that window. Don't assume ordinary spend "counts by default" — check `/benefits` when the reminder fires.

### Airline Credit — S$100 per 6 months (max S$200/year)
- **What it is:** Statement credit for SIA/Scoot flight purchases.
- **Tracked:** Semi-automatically — the bot suggests a match when it sees an SIA/Scoot transaction ≥S$300.
- **What you must do yourself:**
  1. **Save the benefit to your card first** (in the Amex app/site) — if you haven't, nothing qualifies, and the bot can't tell.
  2. Buy the flight **in-app or online directly with SIA/Scoot**, in SGD. Third-party travel agents, OTAs, and KrisShop don't count.
  3. Confirm the credit in `/benefits` once it posts (within ~30 days).
- **No rollover** between Jan–Jun and Jul–Dec. Expires 31 Dec 2026.

### Global Dining Credit — up to S$200/year
- **What it is:** Credit for dining **overseas** (outside Singapore).
- **Tracked:** Semi-automatically — low confidence, since the bot can't see restaurant eligibility or payment channel.
- **What you must do yourself:**
  1. Save the benefit to your card first.
  2. Dine **in-person, outside Singapore**, at a restaurant on Amex's participating list (check before you go).
  3. Pay **directly at the table** with your Platinum Card — not via QR, not via an in-restaurant app.
  4. Avoid the last day of the redemption window — transactions near the cutoff can miss the period.
- Redemption period for 2026: **2 Mar – 31 Dec** (partial first year). Expires 31 Dec 2026.

### Platinum Wine Credit — S$200 per 6 months (max S$400/year)
- **What it is:** Credit for wine purchases at a specific Amex-run storefront.
- **Tracked:** Semi-automatically — merchant name is distinctive, so this one's fairly reliable.
- **What you must do yourself:**
  1. Save the benefit to your card first.
  2. Buy **only at the Platinum Wine Website (powered by Vivino)** — nowhere else counts.
  3. Single transaction ≥S$300, in SGD, paid directly (no third-party processor).
- No rollover between halves. Expires 31 Dec 2026.

### Table for Two — free meal for 2, every 2 months (6x/year)
- **What it is:** A complimentary dining experience, not a statement credit.
- **Tracked:** Manually only — there's no transaction to detect.
- **What you do:**
  1. Book via the **Amex Experiences App** (not by calling the restaurant).
  2. Pick from the current cycle's restaurant list (rotates — check the app).
  3. On the day, scan the restaurant's QR code to redeem.
  4. Log it in `/benefits` with `[Log usage]` so the bot knows this cycle is used.
- Cycles: Jan–Feb, Mar–Apr, May–Jun, Jul–Aug, Sep–Oct, Nov–Dec. **No carryover** — an unused cycle is gone.

### Paragon Club Prestige tier
- **What it is:** Complimentary Prestige-tier membership at Paragon mall, which you keep by hitting a spend threshold.
- **Tracked:** Manually (running total you update yourself) — the qualifying spend is **spend at Paragon mall tenants specifically**, not general Amex spend.
- **What you do:**
  1. Present your Paragon Club QR code when paying at Paragon tenants.
  2. Log each qualifying purchase's amount via `/benefits` → `[Update spend]`.
  3. Hit S$10,000 within 6 months of the upgrade to renew Prestige for 12 months; after that, it's S$25,000/12 months to keep renewing.

### Comoclub C5 tier
- **What it is:** Complimentary C5-tier dining club membership.
- **Tracked:** Manually — qualifying spend is **at COMO Group restaurants and Comoclub partner restaurants specifically** (e.g. Candlenut, Nobu Singapore, Iggy's), not general Amex spend.
- **What you do:**
  1. Dine at a qualifying restaurant, paying with your Platinum Card.
  2. Log the amount via `/benefits` → `[Update spend]`.
  3. Hit S$25,000 within 12 months to maintain C5.

### Sands LifeStyle Prestige tier
- **What it is:** Complimentary Prestige-tier status at Marina Bay Sands.
- **Tracked:** Manually — qualifying spend is very likely Marina-Bay-Sands-specific (hotel/retail/F&B/casino), though this wasn't 100% confirmed from Amex's own T&Cs.
- **What you do:**
  1. Spend at MBS properties/outlets.
  2. Log the amount via `/benefits` → `[Update spend]`.
  3. Hit S$1,500 within the first 3 months, then S$5,000/12 months thereafter, or you're reverted to the base LifeStyle tier.

### Pan Pacific DISCOVERY Platinum status
- **What it is:** Complimentary top-tier status with Pan Pacific/PARKROYAL hotels.
- **Tracked:** One-time checklist (enrollment), plus an optional manual note on maintenance spend.
- **What you do:**
  1. Request the upgrade via the Amex Experiences App **before 31 Dec 2026**.
  2. Mark it `[Mark enrolled]` in `/benefits` once confirmed.
  3. To maintain status after your complimentary period: 10 qualifying nights OR US$5,000/year at Pan Pacific hotels. Log manually if you're tracking toward this.

### One-time status perks (set up once, then ignore)
These don't need ongoing tracking — once enrolled, the status is standing. Just tap `[Mark enrolled]` in `/benefits` for each as you set it up, and they'll drop into the collapsed "Set up ✅" section:

- **Marriott Bonvoy Gold Elite** — enroll via the Marriott Bonvoy program; lasts as long as you hold the card.
- **Hilton Honors Gold** — enroll via Hilton; same deal, offer valid till 31 Dec 2026.
- **Radisson Rewards Premium** — enroll via Radisson Rewards.
- **Hertz Gold Plus Rewards Five Star** — enroll via Hertz.
- **Tower Club Singapore access** — present your Platinum Card at the Tower Club concierge; no enrollment step beyond that, but worth marking so you remember you have it.
- **The Bicester Collection access** — download the eVIP pass, present with your card at a participating Village.
- **Global Lounge Collection** — no setup; just present your card at participating lounges.

---

## 4. Quick reference — what needs your attention vs what's automatic

| Benefit | Auto-tracked | You must do |
|---|---|---|
| Gift A (min spend) | ✅ Fully | Nothing — just spend normally on the card |
| Gift B (15th month) | ✅ Fully | Make sure you spend *something* in the window |
| Airline Credit | ⚠️ Suggested only | Save benefit, buy direct SIA/Scoot, confirm |
| Global Dining Credit | ⚠️ Suggested only | Save benefit, overseas dine-in, direct payment |
| Platinum Wine Credit | ⚠️ Suggested only | Save benefit, buy via Vivino site only |
| Table for Two | ❌ Manual | Book in-app, log usage every cycle |
| Paragon Club | ❌ Manual total | Log Paragon-specific spend yourself |
| Comoclub C5 | ❌ Manual total | Log Comoclub-restaurant spend yourself |
| Sands LifeStyle | ❌ Manual total | Log MBS spend yourself |
| Pan Pacific DISCOVERY | ❌ One-time + manual | Enroll once; log hotel spend if maintaining |
| Status perks (Marriott/Hilton/etc.) | ❌ One-time only | Enroll once, mark done |
