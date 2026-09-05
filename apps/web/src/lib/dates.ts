/**
 * Dates, in Arabic, on the Gregorian calendar.
 *
 * `ca-gregory` is not decoration. `ar-SA` selects the Umm al-Qura Hijri calendar
 * by default in ICU, so `Intl.DateTimeFormat("ar-SA")` on a date in 2026 renders
 * a Hijri year — a correct rendering of a different calendar, which is the worst
 * kind of wrong here. Court deadlines and filing dates in these records are
 * Gregorian, and a silently converted year is not an obviously broken date; it
 * is a plausible one that is off by roughly 579 years.
 *
 * `nu-latn` for the same reason the case numbers and the pagination range use
 * Latin digits: Saudi usage is predominantly Latin numerals, and mixing the two
 * within one screen reads as an inconsistency rather than a choice.
 *
 * The API sends ISO 8601 strings in UTC. These are rendered in the reader's own
 * time zone, which is right for a timestamp — "when did this happen to me" —
 * and would be wrong for a date-only field such as a filing deadline, where the
 * calendar day must not shift with the reader's location. No such field exists
 * yet; when one does, it needs its own formatter with an explicit time zone.
 */
const dateFormatter = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const dateTimeFormatter = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", {
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDate(iso: string): string {
  return dateFormatter.format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  return dateTimeFormatter.format(new Date(iso));
}
