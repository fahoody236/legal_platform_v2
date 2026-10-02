import { Inject, Injectable } from "@nestjs/common";
import type { Readable } from "node:stream";
import {
  addDocumentVersion,
  archiveDocument,
  caseExistsForDocuments,
  createDocument,
  findDocumentById,
  findDocumentVersionForDownload,
  listDocuments,
  lockDocument,
  withTenant,
  type Database,
  type Document,
  type DocumentVersion,
  type DocumentWithVersions,
  type ListDocumentsFilters,
  type ListDocumentsResult,
} from "@legal/db";
import { AuditService } from "../audit/audit.service.js";
import type { Actor } from "../common/request-context.js";
import { DATABASE } from "../database/database.module.js";
import type { CreateDocumentInput } from "./dto.js";
import {
  DOCUMENT_SCANNER,
  type DocumentScanner,
  type ScanVerdict,
} from "./scanning/document-scanner.js";
import {
  DOCUMENT_STORAGE,
  type DocumentStorage,
} from "./storage/document-storage.js";
import type { InspectedUpload } from "./upload.pipe.js";

/** Why an upload was refused after it passed the type check. */
export type UploadRefusal =
  /** The case or document does not resolve in this firm. */
  | { refused: "not_found" }
  /** A new version on an archived document. */
  | { refused: "document_archived" }
  /** The scanner found something. */
  | { refused: "rejected_by_scan" };

export interface Download {
  document: Document;
  version: DocumentVersion;
  content: Readable;
}

/**
 * The audit detail every upload carries: what was stored, identified by
 * value. The checksum is the part that makes it evidence — with it, "this
 * file is the one uploaded on the 3rd" is a comparison anyone can run, not a
 * claim. The file name and titles are absent for the reason hearing notes
 * are: they are free text about a client's matter, and the trail is meant to
 * be disclosable to the firm long after the document is archived.
 */
function versionDetail(version: DocumentVersion, scan: ScanVerdict) {
  return {
    versionId: version.id,
    versionNumber: version.versionNumber,
    contentType: version.contentType,
    sizeBytes: version.sizeBytes,
    checksum: version.checksum,
    // `not_scanned` until Phase 4. Recorded so that the set of versions which
    // entered without a scan is a query, not a reconstruction.
    scan: scan.status,
    ...(scan.status === "not_scanned" ? {} : { scanEngine: scan.engine }),
  };
}

@Injectable()
export class DocumentsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage,
    @Inject(DOCUMENT_SCANNER) private readonly scanner: DocumentScanner,
    private readonly audit: AuditService,
  ) {}

  async list(
    actor: Actor,
    filters: ListDocumentsFilters,
  ): Promise<ListDocumentsResult> {
    return withTenant(this.db, actor.firmId, (tx) => listDocuments(tx, filters));
  }

  async findById(
    actor: Actor,
    id: string,
  ): Promise<DocumentWithVersions | undefined> {
    return withTenant(this.db, actor.firmId, (tx) => findDocumentById(tx, id));
  }

  /**
   * A new document and its first version, in one transaction with its audit
   * entry.
   *
   * The scan runs before the transaction opens, so a slow scanner holds no
   * connection. The case is checked before the bytes are written, so the
   * ordinary refusal — a case that does not resolve — leaves nothing in
   * storage. What can still orphan a file is a failure between `put` and
   * commit; see document-storage.ts.
   */
  async create(
    actor: Actor,
    input: CreateDocumentInput,
    upload: InspectedUpload,
  ): Promise<DocumentWithVersions | UploadRefusal> {
    const scan = await this.scan(upload);

    if (scan.status === "infected") {
      return { refused: "rejected_by_scan" };
    }

    return withTenant(this.db, actor.firmId, async (tx) => {
      if (!(await caseExistsForDocuments(tx, input.caseId))) {
        return { refused: "not_found" } as const;
      }

      const { key } = await this.storage.put({
        firmId: actor.firmId,
        content: upload.content,
        contentType: upload.contentType,
      });

      const document = await createDocument(tx, {
        caseId: input.caseId,
        titleAr: input.titleAr,
        title: input.title,
        description: input.description,
        createdByUserId: actor.userId,
      });

      const version = await addDocumentVersion(tx, {
        documentId: document.id,
        fileName: upload.fileName,
        contentType: upload.contentType,
        sizeBytes: upload.sizeBytes,
        storageKey: key,
        checksum: upload.checksum,
        uploadedByUserId: actor.userId,
      });

      await this.audit.record(tx, {
        action: "documents.uploaded",
        resourceType: "document",
        resourceId: document.id,
        actorUserId: actor.userId,
        detail: { caseId: document.caseId, ...versionDetail(version, scan) },
        ip: actor.ip,
      });

      const created = await findDocumentById(tx, document.id);

      if (!created) {
        throw new Error("DocumentsService.create: new document not readable");
      }

      return created;
    });
  }

  /**
   * The next version of an existing document.
   *
   * The document row is locked first, so two uploads racing for the same
   * document are numbered one after the other rather than colliding on the
   * unique key. An archived document takes no new versions: archiving takes
   * it out of the active file, and a corrected draft of something archived is
   * a reason to un-archive it — a decision for someone with
   * `documents.manage`, not a side effect of an upload.
   */
  async addVersion(
    actor: Actor,
    documentId: string,
    upload: InspectedUpload,
  ): Promise<DocumentWithVersions | UploadRefusal> {
    const scan = await this.scan(upload);

    if (scan.status === "infected") {
      return { refused: "rejected_by_scan" };
    }

    return withTenant(this.db, actor.firmId, async (tx) => {
      const document = await lockDocument(tx, documentId);

      if (!document) {
        return { refused: "not_found" } as const;
      }

      if (document.archivedAt) {
        return { refused: "document_archived" } as const;
      }

      const { key } = await this.storage.put({
        firmId: actor.firmId,
        content: upload.content,
        contentType: upload.contentType,
      });

      const version = await addDocumentVersion(tx, {
        documentId: document.id,
        fileName: upload.fileName,
        contentType: upload.contentType,
        sizeBytes: upload.sizeBytes,
        storageKey: key,
        checksum: upload.checksum,
        uploadedByUserId: actor.userId,
      });

      await this.audit.record(tx, {
        action: "documents.version_added",
        resourceType: "document",
        resourceId: document.id,
        actorUserId: actor.userId,
        detail: { caseId: document.caseId, ...versionDetail(version, scan) },
        ip: actor.ip,
      });

      const updated = await findDocumentById(tx, document.id);

      if (!updated) {
        throw new Error("DocumentsService.addVersion: document not readable");
      }

      return updated;
    });
  }

  /**
   * Opens one version for download and records that it was released.
   *
   * ── The entry is written before the bytes are sent ───────────────────────
   *
   * The audit write commits with the transaction, and the transaction commits
   * before the first byte leaves. So a download that fails partway — a
   * dropped connection, a checksum mismatch — still has an entry. That is the
   * deliberate direction: this event is what the audit log exists for (the
   * departing employee, docs/threat-model.md), and for it a missing entry is
   * the failure that matters while a surplus one is not. An entry for a
   * download that did not complete says the platform released the file to
   * this person, which is true. An action with no entry, which is what the
   * other ordering risks, is unprovable.
   *
   * The storage is opened before the entry is written, so a version whose
   * bytes cannot be found fails with no entry and no response body — that is
   * a fault to investigate, not a download.
   *
   * Archived documents remain downloadable. Archiving takes a document out of
   * active views; it does not take it out of the record, and someone with
   * `documents.download` reviewing a closed matter needs exactly those files.
   */
  async download(
    actor: Actor,
    documentId: string,
    versionNumber: number,
  ): Promise<Download | undefined> {
    let opened: Readable | undefined;

    try {
      return await withTenant(this.db, actor.firmId, async (tx) => {
        const found = await findDocumentVersionForDownload(
          tx,
          documentId,
          versionNumber,
        );

        if (!found) {
          return undefined;
        }

        opened = await this.storage.open({
          firmId: actor.firmId,
          key: found.version.storageKey,
        });

        await this.audit.record(tx, {
          action: "documents.downloaded",
          resourceType: "document",
          resourceId: found.document.id,
          actorUserId: actor.userId,
          detail: {
            caseId: found.document.caseId,
            versionId: found.version.id,
            versionNumber: found.version.versionNumber,
            sizeBytes: found.version.sizeBytes,
            // Which bytes, exactly. With the upload entry's checksum beside
            // it, the trail can show that what left is what came in.
            checksum: found.version.checksum,
          },
          ip: actor.ip,
        });

        return { ...found, content: opened };
      });
    } catch (error) {
      // No committed entry, no download: the audit write or the commit
      // failed, so the bytes are not released and the handle is closed.
      opened?.destroy();
      throw error;
    }
  }

  async archive(actor: Actor, id: string): Promise<Document | undefined> {
    return withTenant(this.db, actor.firmId, async (tx) => {
      const result = await archiveDocument(tx, id);

      if (!result) {
        return undefined;
      }

      // Archiving something already archived changes nothing, and an entry
      // for it would put two archive dates in the trail for one event.
      if (result.changed) {
        await this.audit.record(tx, {
          action: "documents.archived",
          resourceType: "document",
          resourceId: result.document.id,
          actorUserId: actor.userId,
          detail: { caseId: result.document.caseId },
          ip: actor.ip,
        });
      }

      return result.document;
    });
  }

  /**
   * A scanner that throws could not decide, and an undecided file is not let
   * through. The error propagates as a 500: it is the platform's fault, not
   * the uploader's, and should be loud.
   */
  private async scan(upload: InspectedUpload): Promise<ScanVerdict> {
    return this.scanner.scan({
      content: upload.content,
      contentType: upload.contentType,
    });
  }
}
