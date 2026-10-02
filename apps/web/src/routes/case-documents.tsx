import { useState, type ChangeEvent, type FormEvent } from "react";
import { ApiError, isApiError } from "../lib/api.js";
import { formatDateTime } from "../lib/dates.js";
import {
  ACCEPT_ATTRIBUTE,
  MAX_DOCUMENT_BYTES,
  downloadVersion,
  formatSize,
  isAllowedExtension,
  kindLabel,
  stemOf,
  useArchiveDocument,
  useCaseDocuments,
  useUploadDocument,
  useUploadVersion,
  type DocumentRow,
  type DocumentVersionRow,
} from "../lib/documents.js";
import { useHasPermission } from "../lib/session.js";

const ALLOWED_TYPES_TEXT = "PDF أو Word (docx) أو Excel (xlsx) أو صورة";

/**
 * Each refusal the API names, in words that say what to do about it. The
 * codes are the API's (upload.pipe.ts, documents.controller.ts); a status
 * with no code falls through to the general message for that status.
 */
function uploadMessage(error: unknown): string | null {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "unsupported_type":
        return `نوع الملف غير مقبول. الأنواع المقبولة: ${ALLOWED_TYPES_TEXT}.`;
      case "type_mismatch":
        return "محتوى الملف لا يطابق امتداده. تأكّد أن الملف هو ما يدلّ عليه اسمه، ثم حاول مرة أخرى.";
      case "macro_enabled":
        return "الملف يحتوي على وحدات ماكرو، وهي غير مقبولة. احفظه دون وحدات الماكرو (docx أو xlsx) ثم ارفعه.";
      case "file_empty":
        return "الملف فارغ.";
      case "file_missing":
        return "اختر ملفاً للرفع.";
      case "file_name_invalid":
        return "اسم الملف غير صالح. أعد تسميته ثم حاول مرة أخرى.";
      case "document_archived":
        return "هذا المستند مؤرشف ولا يقبل إصدارات جديدة.";
      case "rejected_by_scan":
        return "رُفض الملف بعد فحصه أمنياً.";
      case "storage_unavailable":
        return "تخزين المستندات غير مُهيّأ على هذا الخادم. راجع مسؤول النظام.";
    }

    if (error.status === 413) return "حجم الملف يتجاوز الحد المسموح (50 م.ب).";
    if (error.status === 403) return "لا تملك صلاحية رفع المستندات.";
    if (error.status === 404) return "لم تعد هذه القضية أو هذا المستند متاحاً.";
    if (error.status === 400) return "راجع الحقول ثم حاول مرة أخرى.";
    return "تعذّر الرفع. حاول مرة أخرى.";
  }

  if (error) {
    return "تعذّر الاتصال بالخادم. تحقّق من الاتصال ثم حاول مرة أخرى.";
  }

  return null;
}

function downloadMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return "لا تملك صلاحية تنزيل المستندات.";
    if (error.status === 404) return "لم يعد هذا الإصدار متاحاً.";
    if (error.code === "storage_unavailable") {
      return "تخزين المستندات غير مُهيّأ على هذا الخادم.";
    }
    return "تعذّر تنزيل الملف. حاول مرة أخرى.";
  }

  // Includes the API cutting the transfer short because the stored file no
  // longer matches its checksum. The person cannot tell that apart from a
  // dropped connection, and should not try again silently forever — so the
  // message points somewhere if it persists.
  return "انقطع التنزيل قبل اكتماله. حاول مرة أخرى، وإن تكرر ذلك فأبلغ مسؤول النظام.";
}

/** Checked before the upload starts, so a refusal costs no transfer. */
function precheck(file: File): string | null {
  if (!isAllowedExtension(file.name)) {
    return `نوع الملف غير مقبول. الأنواع المقبولة: ${ALLOWED_TYPES_TEXT}.`;
  }
  if (file.size === 0) return "الملف فارغ.";
  if (file.size > MAX_DOCUMENT_BYTES) {
    return "حجم الملف يتجاوز الحد المسموح (50 م.ب).";
  }
  return null;
}

/**
 * The documents on one matter.
 *
 * Rendered only with `documents.view`, for the reason the hearings section
 * is: without it the section is absent rather than empty, since an empty list
 * would say the matter has no documents.
 *
 * With view and not download, every document and version is listed — title,
 * file name, size, who uploaded it and when — and there is no download
 * control anywhere. That is the arrangement docs/threat-model.md asks for:
 * someone who organises a file can see what is in it without being able to
 * take it. One line under the heading says so, so the missing button reads as
 * a permission rather than a fault.
 */
export function CaseDocuments({ caseId }: { caseId: string }) {
  const canView = useHasPermission("documents.view");
  const canUpload = useHasPermission("documents.upload");
  const canDownload = useHasPermission("documents.download");
  const canManage = useHasPermission("documents.manage");
  const [adding, setAdding] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const documents = useCaseDocuments(caseId, showArchived, canView);

  if (!canView) {
    return null;
  }

  const rows = documents.data?.documents ?? [];

  return (
    <section className="tasks-section">
      <header className="page-header">
        <h2>المستندات</h2>
        {canUpload && !adding && (
          <button type="button" onClick={() => setAdding(true)}>
            رفع مستند
          </button>
        )}
      </header>

      {!canDownload && (
        <p className="hint">
          يمكنك الاطلاع على قائمة المستندات، أما تنزيلها فيتطلب صلاحية «تنزيل
          المستندات».
        </p>
      )}

      <div className="filters">
        <label className="toggle">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(event) => setShowArchived(event.target.checked)}
          />
          عرض المستندات المؤرشفة
        </label>
      </div>

      {adding && (
        <UploadDocumentForm caseId={caseId} onDone={() => setAdding(false)} />
      )}

      {documents.isPending && (
        <p className="state" role="status" aria-live="polite">
          جارٍ تحميل المستندات…
        </p>
      )}

      {isApiError(documents.error, 403) && (
        <p className="state denied" role="alert">
          لا تملك صلاحية عرض المستندات.
        </p>
      )}

      {documents.error && !isApiError(documents.error, 403) && (
        <p className="state error" role="alert">
          تعذّر تحميل المستندات. حاول مرة أخرى.
        </p>
      )}

      {documents.isSuccess && rows.length === 0 && !adding && (
        <p className="state empty">لا توجد مستندات على هذه القضية.</p>
      )}

      {rows.length > 0 && (
        <ul className="task-list">
          {rows.map((document) => (
            <DocumentItem
              key={document.id}
              document={document}
              canUpload={canUpload}
              canDownload={canDownload}
              canManage={canManage}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function DocumentItem({
  document,
  canUpload,
  canDownload,
  canManage,
}: {
  document: DocumentRow;
  canUpload: boolean;
  canDownload: boolean;
  canManage: boolean;
}) {
  const [mode, setMode] = useState<"view" | "version" | "archive">("view");
  const [showVersions, setShowVersions] = useState(false);

  const latest = document.versions[0];
  const archived = document.archivedAt !== null;
  const earlier = document.versions.slice(1);

  if (mode === "version") {
    return (
      <li className="task-form-row">
        <UploadVersionForm document={document} onDone={() => setMode("view")} />
      </li>
    );
  }

  if (mode === "archive") {
    return (
      <li className="task-form-row">
        <ArchiveConfirm document={document} onDone={() => setMode("view")} />
      </li>
    );
  }

  return (
    <li className={archived ? "task done" : "task"}>
      <div className="task-main">
        <div className="task-title">
          <strong>{document.titleAr}</strong>
          {latest && (
            <span
              className="badge"
              style={{ color: "#55554e", background: "#f0f0ee" }}
            >
              {kindLabel(latest.contentType)}
            </span>
          )}
          {document.versions.length > 1 && (
            <span
              className="badge"
              style={{ color: "#1f3d8f", background: "#e9eefb" }}
            >
              الإصدار {latest?.versionNumber}
            </span>
          )}
          {archived && (
            <span
              className="badge"
              style={{ color: "#8a5a06", background: "#fdf3e3" }}
            >
              مؤرشف
            </span>
          )}
        </div>

        {document.title && (
          <p className="task-meta">
            <span dir="ltr">{document.title}</span>
          </p>
        )}

        {latest && <VersionMeta version={latest} />}

        {document.description && (
          <p className="task-description">{document.description}</p>
        )}

        {earlier.length > 0 && (
          <>
            <button
              type="button"
              className="link"
              aria-expanded={showVersions}
              onClick={() => setShowVersions((value) => !value)}
            >
              {showVersions
                ? "إخفاء الإصدارات السابقة"
                : `الإصدارات السابقة (${earlier.length})`}
            </button>

            {showVersions && (
              <ul className="plain-list">
                {earlier.map((version) => (
                  <li key={version.id} className="task-meta">
                    <strong>الإصدار {version.versionNumber}</strong>
                    <span className="muted"> · </span>
                    <VersionMeta version={version} inline />
                    {canDownload && (
                      <>
                        <span className="muted"> · </span>
                        <DownloadButton
                          documentId={document.id}
                          version={version}
                          label="تنزيل"
                        />
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <div className="task-actions">
        {/*
          Absent without documents.download, not disabled. The API refuses
          regardless; a greyed-out button would only invite the question of
          how to make it work, which the hint above the list answers once.
        */}
        {canDownload && latest && (
          <DownloadButton documentId={document.id} version={latest} label="تنزيل" />
        )}
        {canUpload && !archived && (
          <button type="button" className="link" onClick={() => setMode("version")}>
            رفع إصدار جديد
          </button>
        )}
        {canManage && !archived && (
          <button type="button" className="link" onClick={() => setMode("archive")}>
            أرشفة
          </button>
        )}
      </div>
    </li>
  );
}

/** File name, size, who uploaded it and when. */
function VersionMeta({
  version,
  inline = false,
}: {
  version: DocumentVersionRow;
  inline?: boolean;
}) {
  const content = (
    <>
      {/* The file name may be Latin or Arabic; `auto` lets each read in its
          own direction instead of being reordered around the dots. */}
      <bdi>{version.fileName}</bdi>
      <span className="muted"> · </span>
      {formatSize(version.sizeBytes)}
      <span className="muted"> · </span>
      {version.uploadedByName ?? <span className="muted">مستخدم غير معروف</span>}
      <span className="muted"> · </span>
      {formatDateTime(version.createdAt)}
    </>
  );

  return inline ? content : <p className="task-meta">{content}</p>;
}

function DownloadButton({
  documentId,
  version,
  label,
}: {
  documentId: string;
  version: DocumentVersionRow;
  label: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setPending(true);
    setError(null);
    try {
      await downloadVersion(documentId, version);
    } catch (caught) {
      setError(downloadMessage(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="link"
        disabled={pending}
        onClick={() => void handleClick()}
      >
        {pending ? "جارٍ التنزيل…" : label}
      </button>
      {error && (
        <span className="field-error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}

/** A file input that pre-checks what it is given. */
function FileField({
  id,
  disabled,
  onChange,
}: {
  id: string;
  disabled: boolean;
  onChange: (file: File | null, problem: string | null) => void;
}) {
  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    onChange(file, file ? precheck(file) : null);
  }

  return (
    <div className="field">
      <label htmlFor={id}>الملف</label>
      <input
        id={id}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        required
        disabled={disabled}
        onChange={handleChange}
      />
      <p className="hint">
        {ALLOWED_TYPES_TEXT}، بحد أقصى 50 م.ب. ملفات doc وxls القديمة غير
        مقبولة؛ احفظها بصيغة docx أو xlsx أولاً.
      </p>
    </div>
  );
}

/**
 * A new document: the file, and the Arabic title it will be listed under.
 *
 * The title is pre-filled from the file name, since that is usually close to
 * right — but only while the person has not typed one, so choosing a second
 * file does not overwrite a title they wrote.
 */
function UploadDocumentForm({
  caseId,
  onDone,
}: {
  caseId: string;
  onDone: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [titleAr, setTitleAr] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const upload = useUploadDocument();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!file) {
      setProblem("اختر ملفاً للرفع.");
      return;
    }

    if (problem || titleAr.trim() === "") {
      return;
    }

    upload.mutate(
      {
        caseId,
        titleAr: titleAr.trim(),
        title: title.trim(),
        description: description.trim(),
        file,
      },
      { onSuccess: onDone },
    );
  }

  const error = problem ?? uploadMessage(upload.error);

  return (
    <form className="task-form" onSubmit={handleSubmit} noValidate>
      <h3>رفع مستند</h3>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <FileField
        id="document-file-new"
        disabled={upload.isPending}
        onChange={(chosen, chosenProblem) => {
          setFile(chosen);
          setProblem(chosenProblem);
          upload.reset();
          if (chosen && !titleTouched) {
            setTitleAr(stemOf(chosen.name));
          }
        }}
      />

      <div className="field">
        <label htmlFor="document-title-ar">عنوان المستند</label>
        <input
          id="document-title-ar"
          type="text"
          required
          value={titleAr}
          disabled={upload.isPending}
          onChange={(event) => {
            setTitleAr(event.target.value);
            setTitleTouched(true);
          }}
        />
      </div>

      <div className="task-form-row-inline">
        <div className="field">
          <label htmlFor="document-title">العنوان (لاتيني) — اختياري</label>
          <input
            id="document-title"
            type="text"
            dir="ltr"
            value={title}
            disabled={upload.isPending}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
      </div>

      <div className="field">
        <label htmlFor="document-description">وصف — اختياري</label>
        <textarea
          id="document-description"
          rows={2}
          value={description}
          disabled={upload.isPending}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>

      <div className="form-actions">
        <button
          type="submit"
          disabled={upload.isPending || problem !== null || titleAr.trim() === ""}
        >
          {upload.isPending ? "جارٍ الرفع…" : "رفع"}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={upload.isPending}
          onClick={onDone}
        >
          إلغاء
        </button>
      </div>
    </form>
  );
}

/**
 * A new version: only the file. The earlier versions stay, listed and — for
 * someone with `documents.download` — downloadable.
 */
function UploadVersionForm({
  document,
  onDone,
}: {
  document: DocumentRow;
  onDone: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const upload = useUploadVersion(document.id);
  const next = (document.versions[0]?.versionNumber ?? 0) + 1;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!file) {
      setProblem("اختر ملفاً للرفع.");
      return;
    }

    if (problem) return;

    upload.mutate(file, { onSuccess: onDone });
  }

  const error = problem ?? uploadMessage(upload.error);

  return (
    <form className="task-form" onSubmit={handleSubmit} noValidate>
      <h3>
        إصدار جديد من «{document.titleAr}» — الإصدار {next}
      </h3>

      <p className="hint">
        تبقى الإصدارات السابقة محفوظة في السجل كما هي.
      </p>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <FileField
        id={`document-file-${document.id}`}
        disabled={upload.isPending}
        onChange={(chosen, chosenProblem) => {
          setFile(chosen);
          setProblem(chosenProblem);
          upload.reset();
        }}
      />

      <div className="form-actions">
        <button type="submit" disabled={upload.isPending || problem !== null}>
          {upload.isPending ? "جارٍ الرفع…" : "رفع الإصدار"}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={upload.isPending}
          onClick={onDone}
        >
          إلغاء
        </button>
      </div>
    </form>
  );
}

/**
 * Archiving, confirmed in place. It is not deletion and the wording says so:
 * the document leaves the active list and stays in the record.
 */
function ArchiveConfirm({
  document,
  onDone,
}: {
  document: DocumentRow;
  onDone: () => void;
}) {
  const archive = useArchiveDocument(document.id);

  const error =
    archive.error instanceof ApiError
      ? archive.error.status === 403
        ? "لا تملك صلاحية أرشفة المستندات."
        : "تعذّرت الأرشفة. حاول مرة أخرى."
      : archive.error
        ? "تعذّر الاتصال بالخادم. تحقّق من الاتصال ثم حاول مرة أخرى."
        : null;

  return (
    <div className="task-form">
      <h3>أرشفة «{document.titleAr}»</h3>

      <p className="hint">
        يُخفى المستند من القائمة النشطة ولا يُحذف؛ يبقى بكل إصداراته في سجل
        القضية، ويمكن عرضه باختيار «عرض المستندات المؤرشفة». لا تُرفع إليه
        إصدارات جديدة بعد الأرشفة.
      </p>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="form-actions">
        <button
          type="button"
          disabled={archive.isPending}
          onClick={() => archive.mutate(undefined, { onSuccess: onDone })}
        >
          {archive.isPending ? "جارٍ الأرشفة…" : "أرشفة المستند"}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={archive.isPending}
          onClick={onDone}
        >
          إلغاء
        </button>
      </div>
    </div>
  );
}
