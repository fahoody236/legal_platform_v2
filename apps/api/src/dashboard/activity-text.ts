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
};

export function activityText(entry: ActivityEntry): string {
  const template = TEMPLATES[entry.action];
  return template ? template(entry) : `إجراء: ${entry.action}`;
}
