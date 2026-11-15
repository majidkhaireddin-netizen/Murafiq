/**
 * Strict Gregorian calendar-day utilities for communication history.
 * Date-only values are never interpreted as UTC timestamps.
 * Kept independent of followUpEngine to avoid import cycles.
 */
export const DEFAULT_APP_TIMEZONE = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
})();

/** Returns YYYY-MM-DD for an instant in the requested IANA time zone. */
export function getDateKeyInTimeZone(
  input: Date | string,
  timeZone: string = DEFAULT_APP_TIMEZONE
): string {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return '';

  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-US-u-ca-gregory', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    formatter = new Intl.DateTimeFormat('en-US-u-ca-gregory', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  }

  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return year && month && day ? `${year.padStart(4, '0')}-${month}-${day}` : '';
}

/** Accepts only a real YYYY-MM-DD calendar day (including leap-year checks). */
export function normalizeStrictDateOnly(input?: string | null): string | null {
  if (typeof input !== 'string') return null;
  const value = input.trim();
  const match = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 100 || month < 1 || month > 12 || day < 1 || day > 31) return null;

  const verified = new Date(Date.UTC(year, month - 1, day));
  return verified.getUTCFullYear() === year &&
    verified.getUTCMonth() === month - 1 &&
    verified.getUTCDate() === day
    ? value
    : null;
}
