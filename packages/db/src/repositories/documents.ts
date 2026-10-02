import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  inArray,
  isNull,
  sql,
} from "drizzle-orm";
import { cases } from "../schema/cases.js";
import { documents, documentVersions } from "../schema/documents.js";
import { users } from "../schema/users.js";
import { currentFirmId, type TenantTransaction } from "../tenant-context.js";
import type { Document, DocumentVersion } from "../schema/documents.js";

export type {
  Document,
  DocumentVersion,
  NewDocument,
  NewDocumentVersion,
} from "../schema/documents.js";

/**
 * A version as anyone holding `documents.view` may see it.
 *
 * Everything except `storageKey`. The key is the storage implementation's
 * business and leaves this package only on the download path, after the
 * permission check — a list response that carried it would be handing out the
 * one value that addresses the bytes, to people who are not allowed them.
 */
export type DocumentVersionSummary = Omit<DocumentVersion, "storageKey"> & {
  uploadedByName: string | null;
};

export interface DocumentWithVersions extends Document {
  createdByName: string | null;
  /** Newest first. Never empty for a document created through the API. */
  versions: DocumentVersionSummary[];
}

// Listed rather than spread-and-omitted, so a column added to the table later
// is not exposed here until someone decides it should be.
const versionSummaryColumns = {
  id: documentVersions.id,
  firmId: documentVersions.firmId,
  documentId: documentVersions.documentId,
  versionNumber: documentVersions.versionNumber,
  fileName: documentVersions.fileName,
  contentType: documentVersions.contentType,
  sizeBytes: documentVersions.sizeBytes,
  checksum: documentVersions.checksum,
  uploadedByUserId: documentVersions.uploadedByUserId,
  createdAt: documentVersions.createdAt,
  uploadedByName: sql<
    string | null
  >`coalesce(${users.fullNameAr}, ${users.fullName})`.as("uploaded_by_name"),
};

const documentColumns = {
  ...getTableColumns(documents),
  createdByName: sql<
    string | null
  >`coalesce(${users.fullNameAr}, ${users.fullName})`.as("created_by_name"),
};

/**
 * Every version of the given documents, newest first within each, in one
 * query — rather than one query per document, which on a case with forty
 * documents is forty round trips inside the caller's transaction.
 */
async function versionsFor(
  tx: TenantTransaction,
  documentIds: string[],
): Promise<Map<string, DocumentVersionSummary[]>> {
  const byDocument = new Map<string, DocumentVersionSummary[]>();

  if (documentIds.length === 0) {
    return byDocument;
  }

  const rows = await tx
    .select(versionSummaryColumns)
    .from(documentVersions)
    .leftJoin(
      users,
      and(
        eq(users.firmId, documentVersions.firmId),
        eq(users.id, documentVersions.uploadedByUserId),
      ),
    )
    .where(inArray(documentVersions.documentId, documentIds))
    .orderBy(
      asc(documentVersions.documentId),
      desc(documentVersions.versionNumber),
    );

  for (const row of rows) {
    const list = byDocument.get(row.documentId);
    if (list) {
      list.push(row);
    } else {
      byDocument.set(row.documentId, [row]);
    }
  }

  return byDocument;
}

export interface ListDocumentsFilters {
  caseId?: string | undefined;
  includeArchived?: boolean | undefined;
  limit: number;
  offset: number;
}

export interface ListDocumentsResult {
  items: DocumentWithVersions[];
  total: number;
}

/**
 * A page of the firm's documents, newest first, each with its versions.
 *
 * Firm-wide: anyone with `documents.view` sees every case's documents. Scoping
 * to "cases I am assigned to" is the record-level scope ADR 0004 defers, and
 * when it arrives it belongs in this `where`, not in a filter applied to what
 * comes back.
 */
export async function listDocuments(
  tx: TenantTransaction,
  filters: ListDocumentsFilters,
): Promise<ListDocumentsResult> {
  const conditions = [
    filters.caseId ? eq(documents.caseId, filters.caseId) : undefined,
    filters.includeArchived ? undefined : isNull(documents.archivedAt),
  ].filter((condition) => condition !== undefined);
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await tx
    .select(documentColumns)
    .from(documents)
    .leftJoin(
      users,
      and(
        eq(users.firmId, documents.firmId),
        eq(users.id, documents.createdByUserId),
      ),
    )
    .where(where)
    .orderBy(desc(documents.createdAt), desc(documents.id))
    .limit(filters.limit)
    .offset(filters.offset);

  const versions = await versionsFor(
    tx,
    rows.map((row) => row.id),
  );

  const [totals] = await tx
    .select({ value: count() })
    .from(documents)
    .where(where);

  return {
    items: rows.map((row) => ({ ...row, versions: versions.get(row.id) ?? [] })),
    total: totals?.value ?? 0,
  };
}

export async function findDocumentById(
  tx: TenantTransaction,
  id: string,
): Promise<DocumentWithVersions | undefined> {
  const [row] = await tx
    .select(documentColumns)
    .from(documents)
    .leftJoin(
      users,
      and(
        eq(users.firmId, documents.firmId),
        eq(users.id, documents.createdByUserId),
      ),
    )
    .where(eq(documents.id, id))
    .limit(1);

  if (!row) {
    return undefined;
  }

  const versions = await versionsFor(tx, [row.id]);
  return { ...row, versions: versions.get(row.id) ?? [] };
}

/**
 * Whether the case exists in this firm. Used before bytes are written, so a
 * request against a case that does not resolve is refused before it leaves a
 * file in storage with nothing pointing at it.
 */
export async function caseExistsForDocuments(
  tx: TenantTransaction,
  caseId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: cases.id })
    .from(cases)
    .where(eq(cases.id, caseId))
    .limit(1);

  return row !== undefined;
}

/**
 * The document, with its row locked until the transaction ends.
 *
 * Taken before a new version is numbered. Two uploads against the same
 * document at the same moment would otherwise both read the same highest
 * number and one would fail on the unique key; with the lock, the second waits
 * for the first to commit and then numbers after it.
 */
export async function lockDocument(
  tx: TenantTransaction,
  id: string,
): Promise<Document | undefined> {
  const [row] = await tx
    .select()
    .from(documents)
    .where(eq(documents.id, id))
    .for("update")
    .limit(1);

  return row;
}

export interface CreateDocumentInput {
  caseId: string;
  titleAr: string;
  title?: string | null;
  description?: string | null;
  createdByUserId: string;
}

/** `firm_id` comes from the tenant context, never the caller. */
export async function createDocument(
  tx: TenantTransaction,
  input: CreateDocumentInput,
): Promise<Document> {
  const firmId = await currentFirmId(tx);

  const [row] = await tx
    .insert(documents)
    .values({
      firmId,
      caseId: input.caseId,
      titleAr: input.titleAr,
      title: input.title ?? null,
      description: input.description ?? null,
      createdByUserId: input.createdByUserId,
    })
    .returning();

  if (!row) {
    throw new Error("createDocument: insert returned no row");
  }

  return row;
}

export interface AddDocumentVersionInput {
  documentId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  storageKey: string;
  checksum: string;
  uploadedByUserId: string;
}

/**
 * Appends the next version. The number is assigned here, never by the caller,
 * and the caller must already hold `lockDocument` on a document that existed
 * before this transaction — or have created it in this one, where nobody else
 * can see it to race.
 */
export async function addDocumentVersion(
  tx: TenantTransaction,
  input: AddDocumentVersionInput,
): Promise<DocumentVersion> {
  const firmId = await currentFirmId(tx);

  const [latest] = await tx
    .select({
      value: sql<number>`coalesce(max(${documentVersions.versionNumber}), 0)`,
    })
    .from(documentVersions)
    .where(eq(documentVersions.documentId, input.documentId));

  const [row] = await tx
    .insert(documentVersions)
    .values({
      firmId,
      documentId: input.documentId,
      versionNumber: Number(latest?.value ?? 0) + 1,
      fileName: input.fileName,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      storageKey: input.storageKey,
      checksum: input.checksum,
      uploadedByUserId: input.uploadedByUserId,
    })
    .returning();

  if (!row) {
    throw new Error("addDocumentVersion: insert returned no row");
  }

  return row;
}

/**
 * One version, storage key included — the download path, and only that.
 *
 * Addressed by document and number together rather than by the version's own
 * id, so the URL names what a person would say: version 3 of this document.
 */
export async function findDocumentVersionForDownload(
  tx: TenantTransaction,
  documentId: string,
  versionNumber: number,
): Promise<{ document: Document; version: DocumentVersion } | undefined> {
  const [row] = await tx
    .select({
      document: getTableColumns(documents),
      version: getTableColumns(documentVersions),
    })
    .from(documentVersions)
    .innerJoin(
      documents,
      and(
        eq(documents.firmId, documentVersions.firmId),
        eq(documents.id, documentVersions.documentId),
      ),
    )
    .where(
      and(
        eq(documentVersions.documentId, documentId),
        eq(documentVersions.versionNumber, versionNumber),
      ),
    )
    .limit(1);

  return row;
}

/**
 * Archives a document, returning it. Already archived is not an error and not
 * a change: the original `archived_at` stands, since that is when it left the
 * active file.
 */
export async function archiveDocument(
  tx: TenantTransaction,
  id: string,
): Promise<{ document: Document; changed: boolean } | undefined> {
  const [updated] = await tx
    .update(documents)
    .set({ archivedAt: sql`now()` })
    .where(and(eq(documents.id, id), isNull(documents.archivedAt)))
    .returning();

  if (updated) {
    return { document: updated, changed: true };
  }

  const [existing] = await tx
    .select()
    .from(documents)
    .where(eq(documents.id, id))
    .limit(1);

  return existing ? { document: existing, changed: false } : undefined;
}
