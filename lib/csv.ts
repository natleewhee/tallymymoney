// Item 17: RFC 4180 quoting — a bare comma-to-semicolon swap (the old
// approach) leaves a literal quote or newline in a merchant name to
// produce a malformed row. Quote only when needed, doubling internal
// quotes, so simple fields still read cleanly unquoted.
//
// CSV-injection guard: merchant/description text originates from parsed
// bank emails — untrusted, attacker-influenced input. A value starting
// with =, +, -, @, tab, or CR is a formula trigger in Excel/Sheets, so
// prefix a leading apostrophe to force text interpretation before RFC
// 4180 quoting runs.
export function csvField(value: string | number): string {
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
