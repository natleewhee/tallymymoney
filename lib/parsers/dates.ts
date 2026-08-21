// Every bank sampled reports in Singapore local time, either explicitly
// (SGT) or implicitly (Citibank's "Transaction time" has no timezone
// marker, but every other field on the same email is SGT — assumed, not
// proven, flagged inline below). SGT is UTC+8 with no daylight saving.

const SGT_OFFSET_MINUTES = 8 * 60;

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function sgtToUtc(year: number, month0: number, day: number, hour: number, minute: number, second = 0): Date {
  // Construct as if UTC, then shift back by the SGT offset to get real UTC.
  const asIfUtc = Date.UTC(year, month0, day, hour, minute, second);
  return new Date(asIfUtc - SGT_OFFSET_MINUTES * 60 * 1000);
}

/** DBS table shape: "16 Aug 12:43" / "16 AUG 18:56" — no year given.
 * Uses the email's own received date for the year, with a one-off
 * wraparound guard for messages parsed near a year boundary. */
export function parseDbsTableDate(s: string, referenceDate: Date): Date {
  const m = s.trim().match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{1,2}):(\d{2})$/);
  if (!m) throw new Error(`Unrecognised DBS date format: "${s}"`);
  const [, dayStr, monthStr, hourStr, minuteStr] = m;
  const month0 = MONTHS[monthStr.slice(0, 3).toLowerCase()];
  if (month0 === undefined) throw new Error(`Unrecognised month in DBS date: "${s}"`);

  let year = referenceDate.getUTCFullYear();
  // If the transaction month is Dec but the email arrived in Jan (or vice
  // versa), the year guess above is off by one. Rare in practice — flag
  // rather than silently get it wrong the other 99% of the time.
  const refMonth0 = referenceDate.getUTCMonth();
  if (month0 === 11 && refMonth0 === 0) year -= 1;
  if (month0 === 0 && refMonth0 === 11) year += 1;

  return sgtToUtc(year, month0, Number(dayStr), Number(hourStr), Number(minuteStr));
}

/** DBS inline PayNow-received shape: "11 Aug 2026 17:17" — the year is
 * stated in the email, so it is used as given.
 *
 * Deliberately NOT routed through parseDbsTableDate. That function's
 * Dec/Jan guard exists to correct a *guessed* year, and corrupts a known
 * one: the caller used to pass Date.UTC(year, 0, 1) as its reference,
 * which is always January, so any December transaction hit the
 * "Dec transaction, Jan email" branch and silently lost a year — filing
 * it twelve months in the past, out of every report. Harmless eleven
 * months of the year, which is why it survived review. See
 * docs/LESSONS.md. */
export function parseDbsExplicitDate(s: string): Date {
  const m = s.trim().match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})\s+(\d{1,2}):(\d{2})$/);
  if (!m) throw new Error(`Unrecognised DBS explicit-year date: "${s}"`);
  const [, dayStr, monthStr, yearStr, hourStr, minuteStr] = m;
  const month0 = MONTHS[monthStr.slice(0, 3).toLowerCase()];
  if (month0 === undefined) throw new Error(`Unrecognised month in DBS date: "${s}"`);
  return sgtToUtc(Number(yearStr), month0, Number(dayStr), Number(hourStr), Number(minuteStr));
}

/** UOB card/PayNow-received long form: "11-AUG-2026 01:44PM" */
export function parseUobLongDate(s: string): Date {
  const m = s.trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})\s+(\d{1,2}):(\d{2})(AM|PM)$/i);
  if (!m) throw new Error(`Unrecognised UOB date format: "${s}"`);
  const [, dayStr, monthStr, yearStr, hourStr, minuteStr, ampm] = m;
  const month0 = MONTHS[monthStr.toLowerCase()];
  if (month0 === undefined) throw new Error(`Unrecognised month in UOB date: "${s}"`);
  let hour = Number(hourStr) % 12;
  if (ampm.toUpperCase() === "PM") hour += 12;
  return sgtToUtc(Number(yearStr), month0, Number(dayStr), hour, Number(minuteStr));
}

/** UOB card short form: "09/08/26" (DD/MM/YY), no time given. Midnight
 * SGT is a stated approximation, not a fact — the real time is unknown. */
/** UOB's card-spend template states a date ("on 20/08/26") but never a
 * time — confirmed live 2026-08-21: a purchase around 7pm SGT was
 * showing as 12:00am, because every prior version of this function
 * fabricated midnight rather than admit the time isn't known.
 *
 * The email itself is a real-time alert, so its own Date header is a
 * far better proxy for the actual purchase time than a made-up
 * constant. The bank's stated date still wins for the calendar day —
 * reports group by day, and that field is the one UOB actually vouches
 * for — only the hour/minute are borrowed from receivedAt. */
export function parseUobShortDate(s: string, receivedAt: Date): Date {
  const m = s.trim().match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  if (!m) throw new Error(`Unrecognised UOB short date format: "${s}"`);
  const [, dayStr, monthStr, yyStr] = m;
  const year = 2000 + Number(yyStr);
  const sgtReceived = new Date(receivedAt.getTime() + SGT_OFFSET_MINUTES * 60 * 1000);
  return sgtToUtc(
    year,
    Number(monthStr) - 1,
    Number(dayStr),
    sgtReceived.getUTCHours(),
    sgtReceived.getUTCMinutes(),
  );
}

/** Trust: "16 Aug 2026 12:45SGT" — no space before the SGT suffix. */
export function parseTrustDate(s: string): Date {
  const m = s.trim().match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})\s+(\d{1,2}):(\d{2})SGT$/i);
  if (!m) throw new Error(`Unrecognised Trust date format: "${s}"`);
  const [, dayStr, monthStr, yearStr, hourStr, minuteStr] = m;
  const month0 = MONTHS[monthStr.slice(0, 3).toLowerCase()];
  if (month0 === undefined) throw new Error(`Unrecognised month in Trust date: "${s}"`);
  return sgtToUtc(Number(yearStr), month0, Number(dayStr), Number(hourStr), Number(minuteStr));
}

/** Citibank: separate "20/04/26" (DD/MM/YY) and "05:38:23" fields.
 * Timezone is ASSUMED SGT — never stated in the sample. */
export function parseCitiDate(dateStr: string, timeStr: string): Date {
  const dm = dateStr.trim().match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  const tm = timeStr.trim().match(/^(\d{2}):(\d{2}):(\d{2})$/);
  if (!dm) throw new Error(`Unrecognised Citibank date format: "${dateStr}"`);
  if (!tm) throw new Error(`Unrecognised Citibank time format: "${timeStr}"`);
  const [, dayStr, monthStr, yyStr] = dm;
  const [, hourStr, minuteStr, secondStr] = tm;
  const year = 2000 + Number(yyStr);
  return sgtToUtc(year, Number(monthStr) - 1, Number(dayStr), Number(hourStr), Number(minuteStr), Number(secondStr));
}
