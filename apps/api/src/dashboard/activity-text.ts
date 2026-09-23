import type { ActivityEntry } from "@legal/db";

/**
 * Audit action keys, as Arabic sentences.
 *
 * ── Verbal nouns, not verbs ──────────────────────────────────────────────────
 *
 * "إنشاء القضية" rather than "أنشأ القضية". An Arabic past-tense verb agrees
 * with its subject in gender — أنشأ for a man, أنشأت for a woman — and `users`
 * records no gender, so any verb form would misgender a good share of the
 * firm. The masdar has no subject to agree with; it is also how Arabic system
 * logs are conventionally phrased. The actor is a separate field, and the
 * interface puts the two side by side.
 *
 * ── What the label falls back to ─────────────────────────────────────────────
 *
 * Records are never deleted, so the resource named by an entry should always
 * resolve. `withLabel` still handles null — a case number that never arrived
 * renders as "(سجل غير متاح)" rather than as an empty string in the middle of
 * a sentence — because the feed must render whatever the database holds, and
 * a blank is indistinguishable from a bug.
 *
 * ── Unknown keys ─────────────────────────────────────────────────────────────
 *
 * A key with no template renders as "إجراء: <key>". That is deliberately ugly:
 * it is visible, so the missing template gets added, and it is not a crash, so
 * one new action does not take the dashboard down.
 */

function withLabel(prefix: string, label: string | null): string {
  return `${prefix} ${label ?? "(سجل غير متاح)"}`;
}

function caseLabel(entry: ActivityEntry): string | null {
  if (!entry.caseNumber) return null;
  return entry.caseTitleAr
    ? `${entry.caseNumber} — ${entry.caseTitleAr}`
    : entry.caseNumber;
}

/**
 * Gregorian, Latin digits, Arabic month names — the same choices the
 * interface's dates.ts makes and for the same reasons: `ar-SA` alone selects
 * the Umm al-Qura calendar, which would render a court date roughly 579 years
 * out while looking entirely plausible.
 *
 * Formatted here rather than in the browser because this string is a rendered
 * sentence by the time it leaves the API; the alternative is a template the
 * interface has to reassemble.
 */
const hearingDate = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const HEARING_TYPE_LABELS: Record<string, string> = {
  pleading: "المرافعة",
  judgment: "النطق بالحكم",
  appeal: "الاستئناف",
  expert: "الخبرة",
  other: "الجلسة",
};

/** "جلسة المرافعة — 12 مارس 2026", or null if the row did not resolve. */
function hearingLabel(entry: ActivityEntry): string | null {
  if (!entry.hearingScheduledAt) return null;

  const type = HEARING_TYPE_LABELS[entry.hearingType ?? "other"] ?? "الجلسة";
  return `جلسة ${type} — ${hearingDate.format(entry.hearingScheduledAt)}`;
}

function detailField(entry: ActivityEntry, key: string): unknown {
  const detail = entry.detail;
  if (typeof detail !== "object" || detail === null) return undefined;
  return (detail as Record<string, unknown>)[key];
}

const TEMPLATES: Record<string, (entry: ActivityEntry) => string> = {
  "cases.created": (e) => withLabel("إنشاء القضية", caseLabel(e)),
  "cases.updated": (e) => withLabel("تعديل القضية", caseLabel(e)),
  "cases.assigned": (e) =>
    detailField(e, "to") === null
      ? withLabel("إلغاء إسناد القضية", caseLabel(e))
      : withLabel("إسناد القضية", caseLabel(e)),

  "clients.created": (e) => withLabel("إضافة العميل", e.clientNameAr),
  "clients.updated": (e) => withLabel("تعديل بيانات العميل", e.clientNameAr),
  "clients.archived": (e) => withLabel("أرشفة العميل", e.clientNameAr),

  "clients.representative.added": (e) =>
    withLabel("إضافة الممثل", e.representativeNameAr),
  "clients.representative.updated": (e) =>
    withLabel("تعديل بيانات الممثل", e.representativeNameAr),
  "clients.representative.archived": (e) =>
    withLabel("أرشفة الممثل", e.representativeNameAr),

  "tasks.created": (e) => withLabel("إنشاء المهمة", e.taskTitleAr),
  "tasks.updated": (e) => withLabel("تعديل المهمة", e.taskTitleAr),
  "tasks.assigned": (e) =>
    detailField(e, "to") === null
      ? withLabel("إلغاء إسناد المهمة", e.taskTitleAr)
      : withLabel("إسناد المهمة", e.taskTitleAr),
  "tasks.completed": (e) => withLabel("إنجاز المهمة", e.taskTitleAr),

  "hearings.created": (e) => withLabel("جدولة", hearingLabel(e)),
  "hearings.updated": (e) => withLabel("تعديل", hearingLabel(e)),
  // The status is in the sentence because "the court sat" and "it was called
  // off" are different events, and a reader scanning the feed should not have
  // to open the record to tell them apart.
  "hearings.status_changed": (e) => {
    const to = detailField(e, "to");
    const verb =
      to === "held" ? "انعقاد" : to === "cancelled" ? "إلغاء" : "إعادة جدولة";
    return withLabel(verb, hearingLabel(e));
  },
  // Says whether a new date was set, because "adjourned to the 20th" and
  // "adjourned with no date" are the two outcomes a firm needs to tell apart.
  "hearings.adjourned": (e) =>
    detailField(e, "nextHearingId") === null
      ? `${withLabel("تأجيل", hearingLabel(e))} (بلا تحديد موعد)`
      : withLabel("تأجيل", hearingLabel(e)),
};

export function activityText(entry: ActivityEntry): string {
  const template = TEMPLATES[entry.action];
  return template ? template(entry) : `إجراء: ${entry.action}`;
}
