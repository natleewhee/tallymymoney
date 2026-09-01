// Reports are framed in Singapore local time (FR-13/FR-14), even though
// everything is stored as UTC. SGT is UTC+8, no daylight saving.

const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;

function sgtMidnight(utcNow: Date, dayOffset = 0): Date {
  const sgtNow = new Date(utcNow.getTime() + SGT_OFFSET_MS);
  const sgtMidnightAsUtc = Date.UTC(
    sgtNow.getUTCFullYear(),
    sgtNow.getUTCMonth(),
    sgtNow.getUTCDate() + dayOffset,
  );
  return new Date(sgtMidnightAsUtc - SGT_OFFSET_MS);
}

export function todayRange(now = new Date()): { start: Date; end: Date } {
  return { start: sgtMidnight(now, 0), end: sgtMidnight(now, 1) };
}

export function last7DaysRange(now = new Date()): { start: Date; end: Date } {
  return { start: sgtMidnight(now, -6), end: sgtMidnight(now, 1) };
}

export function currentMonthRange(now = new Date()): { start: Date; end: Date } {
  const sgtNow = new Date(now.getTime() + SGT_OFFSET_MS);
  const start = new Date(
    Date.UTC(sgtNow.getUTCFullYear(), sgtNow.getUTCMonth(), 1) - SGT_OFFSET_MS,
  );
  const end = sgtMidnight(now, 1);
  return { start, end };
}

/** For display in Telegram messages — Nat's timezone, not the UTC the
 * database stores. e.g. "19 Aug 2026, 10:01 am". */
export function formatSgtDateTime(date: Date): string {
  return new Intl.DateTimeFormat("en-SG", {
    timeZone: "Asia/Singapore",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function monthBounds(year: number, month0: number): { start: Date; end: Date } {
  const start = new Date(Date.UTC(year, month0, 1) - SGT_OFFSET_MS);
  const end = new Date(Date.UTC(year, month0 + 1, 1) - SGT_OFFSET_MS);
  return { start, end };
}

/** Full calendar month boundaries in SGT — unlike currentMonthRange's end
 * (deliberately "tomorrow", so a same-day report never misses a
 * same-day transaction), this stays fixed for the whole month. Needed
 * anywhere the month itself is an identity that must not drift depending
 * on which day it's queried — e.g. a settlement record for "August 2026"
 * has to mean the same thing on the 3rd and on the 29th. */
export function currentMonthBounds(now = new Date()): { start: Date; end: Date } {
  const sgtNow = new Date(now.getTime() + SGT_OFFSET_MS);
  return monthBounds(sgtNow.getUTCFullYear(), sgtNow.getUTCMonth());
}

/** Same bounds as currentMonthBounds, for an arbitrary named month —
 * needed by the settle-up callback when it's marking a past month (the
 * automatic monthly report's period), not always "now". */
export function monthBoundsFor(year: number, month0: number): { start: Date; end: Date } {
  return monthBounds(year, month0);
}

/** Same day-of-month cutoff, one calendar month back — e.g. called on the
 * 21st, returns 1–21 August for a September query. Used for /month's
 * month-over-month comparison: a full previous month against a
 * still-in-progress current one is misleading (of course last month
 * looks bigger), so this compares like against like. Clamped to the
 * previous month's actual length so day 31 in a 30-day month doesn't
 * roll into the month after. */
export function previousMonthToDateRange(now = new Date()): { start: Date; end: Date } {
  const sgtNow = new Date(now.getTime() + SGT_OFFSET_MS);
  const y = sgtNow.getUTCFullYear();
  const m = sgtNow.getUTCMonth();
  const day = sgtNow.getUTCDate();
  const prevMonthLength = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cutoffDay = Math.min(day, prevMonthLength);
  const start = new Date(Date.UTC(y, m - 1, 1) - SGT_OFFSET_MS);
  const end = new Date(Date.UTC(y, m - 1, cutoffDay + 1) - SGT_OFFSET_MS);
  return { start, end };
}

function monthLabel(year: number, month0: number): string {
  return new Date(Date.UTC(year, month0, 1)).toLocaleString("en-SG", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Previous calendar month — used by the automatic monthly report (FR-14),
 * which reports on the month that just ended, not the one in progress.
 * year/month0 identify the reported month itself (not "now") — used to
 * key the settlement record and the settle-up button's callback data, so
 * marking it settled after the calendar has rolled to a new month still
 * resolves to the right period. */
export function previousMonthRange(now = new Date()): {
  start: Date;
  end: Date;
  label: string;
  year: number;
  month0: number;
} {
  const sgtNow = new Date(now.getTime() + SGT_OFFSET_MS);
  const y = sgtNow.getUTCFullYear();
  const m = sgtNow.getUTCMonth();
  const { start, end } = monthBounds(y, m - 1);
  // Re-derive year/month0 from `start` (converted back to SGT) rather than
  // reusing y/m-1 directly, so a January report (m-1 = -1) doesn't need
  // its own rollover arithmetic — Date already normalised it.
  const startSgt = new Date(start.getTime() + SGT_OFFSET_MS);
  const year = startSgt.getUTCFullYear();
  const month0 = startSgt.getUTCMonth();
  return { start, end, label: monthLabel(year, month0), year, month0 };
}

/** The full calendar month before the one previousMonthRange reports on —
 * the automatic monthly report's comparison baseline. Deliberately a full
 * month against a full month (unlike /month's previousMonthToDateRange,
 * which clips to a same-day cutoff): the automatic report always runs on
 * the 1st against two already-complete months, so there's no
 * still-in-progress month to clip for. */
export function monthBeforePreviousRange(now = new Date()): { start: Date; end: Date; label: string } {
  const { year, month0 } = previousMonthRange(now);
  const { start, end } = monthBounds(year, month0 - 1);
  const startSgt = new Date(start.getTime() + SGT_OFFSET_MS);
  return { start, end, label: monthLabel(startSgt.getUTCFullYear(), startSgt.getUTCMonth()) };
}
