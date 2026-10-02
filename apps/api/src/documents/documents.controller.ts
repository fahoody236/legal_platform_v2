import type { ServerResponse } from "node:http";
import { pipeline } from "node:stream/promises";
import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  UnprocessableEntityException,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Document, DocumentWithVersions } from "@legal/db";
import type { AuthenticatedRequest } from "../auth/authenticated-request.js";
import { actorOf, translateWriteError } from "../common/request-context.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { RequirePermission } from "../permissions/require-permission.decorator.js";
import { VerifyingStream, writeDownloadHeaders } from "./download.js";
import {
  addVersionSchema,
  createDocumentSchema,
  documentIdSchema,
  listDocumentsQuerySchema,
  versionNumberSchema,
  type CreateDocumentInput,
  type ListDocumentsQuery,
} from "./dto.js";
import { DocumentsService, type UploadRefusal } from "./documents.service.js";
import { StorageUnavailableError } from "./storage/document-storage.js";
import {
  DocumentUploadPipe,
  MAX_DOCUMENT_BYTES,
  type InspectedUpload,
} from "./upload.pipe.js";

/**
 * One file, held in memory, refused at 50 MB while still streaming in.
 *
 * Memory rather than a temporary file because every check needs the whole
 * thing anyway — the zip directory is at the end, the checksum covers all of
 * it — and a temporary file is a second copy of a client document on the
 * server's disk with its own cleanup to get right. The cost is up to 50 MB of
 * memory per upload in flight; at a law firm's upload rate that is the right
 * trade, and it is the first thing to revisit if it stops being one.
 *
 * Guards run before interceptors, so none of this happens for a caller
 * without `documents.upload`: the permission is checked before a byte of the
 * body is read.
 *
 * `defParamCharset: "utf8"` because browsers send the file name as raw UTF-8
 * and multer otherwise decodes it as Latin-1 — every Arabic file name would
 * be stored as mojibake.
 */
const singleFile = FileInterceptor("file", {
  limits: {
    fileSize: MAX_DOCUMENT_BYTES,
    files: 1,
    fields: 10,
    fieldSize: 10 * 1024,
    parts: 11,
  },
  defParamCharset: "utf8",
});

function refusalToException(refusal: UploadRefusal): Error {
  switch (refusal.refused) {
    case "not_found":
      return new NotFoundException();
    case "document_archived":
      return new ConflictException({ code: "document_archived" });
    case "rejected_by_scan":
      return new UnprocessableEntityException({ code: "rejected_by_scan" });
  }
}

function isRefusal(
  result: DocumentWithVersions | UploadRefusal,
): result is UploadRefusal {
  return "refused" in result;
}

/** Storage not configured is a 503 the interface can name; anything else is as-is. */
function translateStorageError(error: unknown): unknown {
  if (error instanceof StorageUnavailableError) {
    return new ServiceUnavailableException({ code: "storage_unavailable" });
  }
  return translateWriteError(error);
}

/**
 * Documents on the firm's matters.
 *
 * ── Every byte passes through here ───────────────────────────────────────────
 *
 * There is no route that returns a storage key, a path, or a signed URL, and
 * the storage interface has no method that could produce one. The only way to
 * a document's content is `GET :id/versions/:version/download`, which checks
 * `documents.download`, writes the audit entry, and then streams. A design
 * with direct links would be faster and would make both of those optional.
 *
 * ── Four permissions ─────────────────────────────────────────────────────────
 *
 * `view` lists what exists; `upload` adds documents and versions; `download`
 * takes the bytes; `manage` archives. The second-to-last is the one that
 * matters: view without download is a person who can file and organise a
 * matter but cannot carry it out of the building (docs/threat-model.md).
 */
@Controller("documents")
export class DocumentsController {
  private readonly logger = new Logger(DocumentsController.name);

  constructor(private readonly documents: DocumentsService) {}

  /**
   * "This case's documents" is this route with `caseId`. Every version is
   * listed with each document, minus its storage key.
   */
  @RequirePermission("documents.view")
  @Get()
  async list(
    @Query(new ZodValidationPipe(listDocumentsQuerySchema))
    query: ListDocumentsQuery,
    @Req() request: AuthenticatedRequest,
  ): Promise<{
    documents: DocumentWithVersions[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const { items, total } = await this.documents.list(actorOf(request), query);

    return { documents: items, total, limit: query.limit, offset: query.offset };
  }

  @RequirePermission("documents.view")
  @Get(":id")
  async findOne(
    @Param("id", new ZodValidationPipe(documentIdSchema)) id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ document: DocumentWithVersions }> {
    const found = await this.documents.findById(actorOf(request), id);

    if (!found) {
      throw new NotFoundException();
    }

    return { document: found };
  }

  /**
   * A new document, with its first version.
   *
   * multipart/form-data: `file`, `caseId`, `titleAr`, and optionally `title`
   * and `description`. 404 for a case outside the firm, exactly as for one
   * that does not exist; 413 past 50 MB; 415 with a `code` for a type that
   * is refused, saying which of the reasons in file-type.ts applied.
   */
  @RequirePermission("documents.upload")
  @Post()
  @UseInterceptors(singleFile)
  async create(
    @UploadedFile(new DocumentUploadPipe()) upload: InspectedUpload,
    @Body(new ZodValidationPipe(createDocumentSchema))
    body: CreateDocumentInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ document: DocumentWithVersions }> {
    let result: DocumentWithVersions | UploadRefusal;

    try {
      result = await this.documents.create(actorOf(request), body, upload);
    } catch (error) {
      throw translateStorageError(error);
    }

    if (isRefusal(result)) {
      throw refusalToException(result);
    }

    return { document: result };
  }

  /**
   * The next version of a document: multipart/form-data with `file` and
   * nothing else. 409 `{ code: "document_archived" }` on an archived one.
   */
  @RequirePermission("documents.upload")
  @Post(":id/versions")
  @UseInterceptors(singleFile)
  async addVersion(
    @Param("id", new ZodValidationPipe(documentIdSchema)) id: string,
    @UploadedFile(new DocumentUploadPipe()) upload: InspectedUpload,
    @Body(new ZodValidationPipe(addVersionSchema)) _body: object,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ document: DocumentWithVersions }> {
    let result: DocumentWithVersions | UploadRefusal;

    try {
      result = await this.documents.addVersion(actorOf(request), id, upload);
    } catch (error) {
      throw translateStorageError(error);
    }

    if (isRefusal(result)) {
      throw refusalToException(result);
    }

    return { document: result };
  }

  /**
   * The bytes of one version, as an attachment.
   *
   * GET, because it reads; it writes only the audit entry, which records the
   * read rather than changing anything. The session cookie is SameSite=Strict,
   * so another site cannot make a signed-in browser issue this request and
   * plant a download in someone's trail.
   *
   * Streams through VerifyingStream, so a stored file that no longer matches
   * its checksum is cut off before its last chunk rather than delivered. The
   * audit entry already exists by then; see DocumentsService.download for
   * why that is the right order.
   */
  @RequirePermission("documents.download")
  @Get(":id/versions/:version/download")
  async download(
    @Param("id", new ZodValidationPipe(documentIdSchema)) id: string,
    @Param("version", new ZodValidationPipe(versionNumberSchema))
    version: number,
    @Req() request: AuthenticatedRequest,
    @Res() response: ServerResponse,
  ): Promise<void> {
    let found;

    try {
      found = await this.documents.download(actorOf(request), id, version);
    } catch (error) {
      throw translateStorageError(error);
    }

    if (!found) {
      throw new NotFoundException();
    }

    writeDownloadHeaders(response, found.version);

    try {
      await pipeline(
        found.content,
        new VerifyingStream(found.version.checksum, found.version.sizeBytes),
        response,
      );
    } catch (error) {
      // Headers are gone; the only signal left to the client is the short
      // body, which `pipeline` has already produced by destroying the
      // response. What remains is to make sure someone hears about it. A
      // client disconnecting mid-download also lands here and is not an
      // integrity fault, so it is logged at a lower level.
      if (isClientAbort(error)) {
        this.logger.warn(
          `Download of document ${id} v${version} ended early: client disconnected`,
        );
        return;
      }

      this.logger.error(
        `Download of document ${id} v${version} failed: ${String(error)}`,
      );
    }
  }

  /**
   * Out of the active file. Idempotent: archiving an archived document
   * returns it unchanged and records nothing.
   */
  @RequirePermission("documents.manage")
  @Post(":id/archive")
  @HttpCode(HttpStatus.OK)
  async archive(
    @Param("id", new ZodValidationPipe(documentIdSchema)) id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ document: Document }> {
    const archived = await this.documents.archive(actorOf(request), id);

    if (!archived) {
      throw new NotFoundException();
    }

    return { document: archived };
  }
}

function isClientAbort(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "ERR_STREAM_PREMATURE_CLOSE" || code === "ECONNRESET";
}
