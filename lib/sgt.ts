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

/** Full calendar month boundaries in SGT — unlike currentMonthRange's end
 * (deliberately "tomorrow", so a same-day report never misses a
 * same-day transaction), this stays fixed for the whole month. Needed
 * anywhere the month itself is an identity that must not drift depending
 * on which day it's queried — e.g. a settlement record for "August 2026"
 * has to mean the same thing on the 3rd and on the 29th. */
export function currentMonthBounds(now = new Date()): { start: Date; end: Date } {
  const sgtNow = new Date(now.getTime() + SGT_OFFSET_MS);
  const y = sgtNow.getUTCFullYear();
  const m = sgtNow.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1) - SGT_OFFSET_MS);
  const end = new Date(Date.UTC(y, m + 1, 1) - SGT_OFFSET_MS);
  return { start, end };
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

/** Previous calendar month — used by the automatic monthly report (FR-14),
 * which reports on the month that just ended, not the one in progress. */
export function previousMonthRange(now = new Date()): { start: Date; end: Date; label: string } {
  const sgtNow = new Date(now.getTime() + SGT_OFFSET_MS);
  const y = sgtNow.getUTCFullYear();
  const m = sgtNow.getUTCMonth();
  const start = new Date(Date.UTC(y, m - 1, 1) - SGT_OFFSET_MS);
  const end = new Date(Date.UTC(y, m, 1) - SGT_OFFSET_MS);
  const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-SG", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return { start, end, label };
}
