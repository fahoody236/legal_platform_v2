import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Transform, type Readable, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { getFirmId, type TenantRequest } from "../tenant/tenant-request.js";
import { HEAD_BYTES, TAIL_BYTES } from "./file-type.js";
import {
  StorageUnavailableError,
  type DocumentStorage,
  type UploadHandle,
} from "./storage/document-storage.js";

/**
 * What the engine adds to multer's file object: everything the pipe needs to
 * decide, and the handle the service needs to commit.
 */
export interface StagedFile {
  handle: UploadHandle;
  size: number;
  /** `sha256:<hex>` of the bytes as received. */
  checksum: string;
  head: Buffer;
  tail: Buffer;
}

/** The slice of multer's file object this code reads, plus the staging. */
export interface ReceivedFile extends StagedFile {
  originalname: string;
  mimetype: string;
}

/**
 * Multer storage engine that streams an upload into the document store's
 * staging area instead of into memory.
 *
 * ── Why an engine ────────────────────────────────────────────────────────────
 *
 * Multer's two bundled engines are memory and a temp directory. Memory is what
 * Phase 3 used, and twenty concurrent uploads at the 50 MB limit is a
 * gigabyte. A temp directory would be a second copy of a client document on
 * the server's disk, outside the storage interface and with its own cleanup.
 * The engine interface — two methods, receive a stream and remove a file — is
 * multer's supported way to put the bytes somewhere else, and it keeps the
 * same `FileInterceptor`, the same `limits`, and the same 413 on the stream
 * before anything is persisted.
 *
 * ── What is kept in memory ───────────────────────────────────────────────────
 *
 * The running hash, the first 8 KB, and the last ~1.1 MB. The type check
 * reads signatures from the head and, for Word and Excel, the zip's central
 * directory from the tail; file-type.ts says why that tail is long enough.
 * Everything else goes straight to the staging file.
 *
 * ── Cleanup ──────────────────────────────────────────────────────────────────
 *
 * Multer calls `_removeFile` when it aborts: a size limit, a second file, a
 * dropped connection. That covers multer's own failures. A refusal later in
 * the request — the type check in the pipe, the case lookup in the service —
 * aborts the handle itself. And as the net under both, every handle is
 * registered against the response: when it closes, any handle still
 * uncommitted is aborted. The startup sweep handles the one case none of
 * these can, a process that died mid-upload.
 */
export class StreamingUploadEngine {
  constructor(private readonly storage: DocumentStorage) {}

  _handleFile(
    request: IncomingMessage,
    file: { stream: Readable },
    callback: (error: unknown, info?: StagedFile) => void,
  ): void {
    void this.stage(request, file.stream).then(
      (info) => callback(null, info),
      (error: unknown) => callback(error),
    );
  }

  _removeFile(
    _request: IncomingMessage,
    file: Partial<StagedFile>,
    callback: (error: unknown) => void,
  ): void {
    const handle = file.handle;

    if (!handle || handle.committed) {
      callback(null);
      return;
    }

    void handle.abort().then(
      () => callback(null),
      (error: unknown) => callback(error),
    );
  }

  private async stage(
    request: IncomingMessage,
    stream: Readable,
  ): Promise<StagedFile> {
    const firmId = getFirmId(request as TenantRequest);

    if (!firmId) {
      throw new UnauthorizedException();
    }

    let handle: UploadHandle;

    try {
      handle = await this.storage.beginUpload({ firmId });
    } catch (error) {
      if (error instanceof StorageUnavailableError) {
        throw new ServiceUnavailableException({ code: "storage_unavailable" });
      }
      throw error;
    }

    abortWhenResponseCloses(request, handle);

    const sink = new SamplingHasher();

    try {
      await pipeline(stream, sink, handle.writable);
    } catch (error) {
      await handle.abort().catch(() => undefined);
      throw error;
    }

    return {
      handle,
      size: sink.size,
      checksum: sink.checksum(),
      head: sink.head(),
      tail: sink.tail(),
    };
  }
}

const UPLOAD_HANDLES = Symbol("legal.upload-handles");

interface RequestWithHandles extends IncomingMessage {
  [UPLOAD_HANDLES]?: UploadHandle[];
  res?: ServerResponse;
}

function abortWhenResponseCloses(
  request: IncomingMessage,
  handle: UploadHandle,
): void {
  const tracked = request as RequestWithHandles;
  const existing = tracked[UPLOAD_HANDLES];

  if (existing) {
    existing.push(handle);
    return;
  }

  tracked[UPLOAD_HANDLES] = [handle];

  tracked.res?.once("close", () => {
    for (const open of tracked[UPLOAD_HANDLES] ?? []) {
      if (!open.committed) {
        void open.abort().catch(() => undefined);
      }
    }
  });
}

/**
 * Passes bytes through while hashing them and keeping the two samples the
 * type check reads. Memory is bounded by the sample sizes whatever the file.
 */
export class SamplingHasher extends Transform {
  private readonly hash = createHash("sha256");
  private readonly headChunks: Buffer[] = [];
  private headLength = 0;
  private readonly tailChunks: Buffer[] = [];
  private tailLength = 0;
  size = 0;

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    this.hash.update(chunk);
    this.size += chunk.length;

    if (this.headLength < HEAD_BYTES) {
      const take = chunk.subarray(0, HEAD_BYTES - this.headLength);
      this.headChunks.push(take);
      this.headLength += take.length;
    }

    this.tailChunks.push(chunk);
    this.tailLength += chunk.length;

    // Drop whole chunks from the front while the rest still covers the tail.
    while (
      this.tailChunks.length > 1 &&
      this.tailLength - (this.tailChunks[0]?.length ?? 0) >= TAIL_BYTES
    ) {
      this.tailLength -= this.tailChunks.shift()?.length ?? 0;
    }

    callback(null, chunk);
  }

  checksum(): string {
    return `sha256:${this.hash.digest("hex")}`;
  }

  head(): Buffer {
    return Buffer.concat(this.headChunks);
  }

  tail(): Buffer {
    const joined = Buffer.concat(this.tailChunks);
    return joined.length > TAIL_BYTES ? joined.subarray(joined.length - TAIL_BYTES) : joined;
  }
}
