import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { ApiError, apiFetch } from "./api.js";

/**
 * Mirrors MAX_DOCUMENT_BYTES and the allowlist in apps/api/src/documents.
 *
 * Checked here only so a person learns before a 50 MB upload rather than after
 * it. The server decides, from the file's content, and refuses anything this
 * lets through that it should not.
 */
export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;

export const ALLOWED_EXTENSIONS = [
  "pdf",
  "docx",
  "xlsx",
  "jpg",
  "jpeg",
  "png",
  "webp",
  "heic",
  "heif",
  "tif",
  "tiff",
] as const;

/** For the file input's `accept`: narrows the picker, enforces nothing. */
export const ACCEPT_ATTRIBUTE = ALLOWED_EXTENSIONS.map((ext) => `.${ext}`).join(
  ",",
);

export function extensionOf(fileName: string): string | undefined {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0 || dot === fileName.length - 1) return undefined;
  return fileName.slice(dot + 1).toLowerCase();
}

export function isAllowedExtension(fileName: string): boolean {
  const extension = extensionOf(fileName);
  return (
    extension !== undefined &&
    (ALLOWED_EXTENSIONS as readonly string[]).includes(extension)
  );
}

/** The name without its extension — the default for a new document's title. */
export function stemOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

/** A version as the list shows it. There is no storage key: the API never sends one. */
export interface DocumentVersionRow {
  id: string;
  documentId: string;
  versionNumber: number;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  checksum: string;
  uploadedByUserId: string;
  uploadedByName: string | null;
  createdAt: string;
}

export interface DocumentRow {
  id: string;
  caseId: string;
  titleAr: string;
  title: string | null;
  description: string | null;
  createdByUserId: string;
  createdByName: string | null;
  createdAt: string;
  archivedAt: string | null;
  /** Newest first. */
  versions: DocumentVersionRow[];
}

export interface DocumentsPage {
  documents: DocumentRow[];
  total: number;
  limit: number;
  offset: number;
}

const sizeFormat = new Intl.NumberFormat("ar-SA-u-nu-latn", {
  maximumFractionDigits: 1,
});

/** "1.4 م.ب" — Latin digits, as dates.ts uses, with Arabic unit abbreviations. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${sizeFormat.format(bytes)} بايت`;
  if (bytes < 1024 * 1024) return `${sizeFormat.format(bytes / 1024)} ك.ب`;
  return `${sizeFormat.format(bytes / (1024 * 1024))} م.ب`;
}

/** A short word for the kind of file, beside the file name. */
export function kindLabel(contentType: string): string {
  if (contentType === "application/pdf") return "PDF";
  if (contentType.includes("wordprocessingml")) return "Word";
  if (contentType.includes("spreadsheetml")) return "Excel";
  if (contentType.startsWith("image/")) return "صورة";
  return "ملف";
}

function retryUnlessAnswered(failureCount: number, error: Error): boolean {
  const status = (error as { status?: number }).status;

  if (status === 401 || status === 403 || status === 404) {
    return false;
  }

  return failureCount < 2;
}

export function useCaseDocuments(
  caseId: string,
  includeArchived: boolean,
  enabled = true,
): UseQueryResult<DocumentsPage> {
  const search = new URLSearchParams({ caseId, limit: "100", offset: "0" });
  if (includeArchived) search.set("includeArchived", "true");

  return useQuery({
    queryKey: ["documents", "list", search.toString()],
    queryFn: () =>
      apiFetch<DocumentsPage>(`/api/documents?${search.toString()}`),
    enabled,
    retry: retryUnlessAnswered,
    placeholderData: (previous) => previous,
  });
}

function useDocumentMutation<TBody, TResult>(
  request: (body: TBody) => Promise<TResult>,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: request,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
  });
}

export interface UploadDocumentBody {
  caseId: string;
  titleAr: string;
  title: string;
  description: string;
  file: File;
}

export function useUploadDocument() {
  return useDocumentMutation((body: UploadDocumentBody) => {
    const form = new FormData();
    form.set("caseId", body.caseId);
    form.set("titleAr", body.titleAr);
    // Empty optional fields are sent as empty and read as absent by the API.
    form.set("title", body.title);
    form.set("description", body.description);
    // Last, so the text fields are parsed before the file streams in.
    form.set("file", body.file);

    return apiFetch<{ document: DocumentRow }>("/api/documents", {
      method: "POST",
      body: form,
    }).then((response) => response.document);
  });
}

export function useUploadVersion(documentId: string) {
  return useDocumentMutation((file: File) => {
    const form = new FormData();
    form.set("file", file);

    return apiFetch<{ document: DocumentRow }>(
      `/api/documents/${encodeURIComponent(documentId)}/versions`,
      { method: "POST", body: form },
    ).then((response) => response.document);
  });
}

export function useArchiveDocument(documentId: string) {
  return useDocumentMutation(() =>
    apiFetch<{ document: DocumentRow }>(
      `/api/documents/${encodeURIComponent(documentId)}/archive`,
      { method: "POST" },
    ),
  );
}

/**
 * Fetches one version and hands it to the browser to save.
 *
 * Through `fetch` rather than a plain link, for two reasons. A link that
 * fails shows the person a bare JSON error page; this reports a 403 or a 404
 * in the interface like every other failure. And the API cuts a download off
 * before its last chunk if the stored file no longer matches its checksum —
 * reading the whole body here means that arrives as a rejected promise and
 * the file is never offered, where a link would leave a truncated file in
 * the downloads folder looking like the real one.
 *
 * The cost is that the file is held in memory before it is saved, which at
 * 50 MB is acceptable.
 */
export async function downloadVersion(
  documentId: string,
  version: DocumentVersionRow,
): Promise<void> {
  const response = await fetch(
    `/api/documents/${encodeURIComponent(documentId)}/versions/${version.versionNumber}/download`,
    { credentials: "include" },
  );

  if (!response.ok) {
    throw new ApiError(response.status, await errorCodeOf(response));
  }

  const blob = await response.blob();

  if (blob.size !== version.sizeBytes) {
    // A short body that the browser did not itself report as a failure.
    throw new Error("Download incomplete");
  }

  const url = URL.createObjectURL(blob);

  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    // The name the file was uploaded under, Arabic included. The API's
    // Content-Disposition says the same, but a blob URL does not carry it.
    anchor.download = version.fileName;
    anchor.rel = "noopener";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Deferred: revoking synchronously can cancel the save in some browsers
    // before it has started reading the blob.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

async function errorCodeOf(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "code" in body) {
      const code = (body as { code: unknown }).code;
      return typeof code === "string" ? code : undefined;
    }
  } catch {
    // No body, or not JSON.
  }
  return undefined;
}
