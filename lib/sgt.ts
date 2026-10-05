// Display and /export ranges are framed in Singapore local time, even though
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
