import type { Readable, Writable } from "node:stream";

/**
 * Where a document's bytes live, behind an interface, because the answer is a
 * hosting decision rather than a library.
 *
 * ── What the database knows ──────────────────────────────────────────────────
 *
 * Only the key `commit` returns. It is opaque: nothing outside the
 * implementation that issued it may parse it, build a path from it, or turn
 * it into a URL. That is what lets the backing store change — local disk now,
 * a second implementation later — without a migration, and what keeps the
 * rule "every download passes through the API" structural. There is no
 * method here that produces an address a browser could fetch directly, so no
 * code path can hand one out.
 *
 * ── Two steps, not one ───────────────────────────────────────────────────────
 *
 * An upload is streamed: `beginUpload` opens a staging area and hands back a
 * writable; the bytes flow into it as they arrive from the client, and only
 * once they have all arrived — and been hashed, typed and scanned — does
 * `commit` make them a stored object with a key. Nothing is held in memory
 * beyond the stream's own chunks and the sample the type check needs.
 *
 * `abort` discards what was staged. It is the one way bytes are ever removed
 * through this interface, and it is bounded by construction: a handle can
 * abort only its own staging area, and an implementation must refuse an
 * abort after a commit rather than rely on callers not to ask. Committed
 * objects are never removed — versions are append-only (migration 0018) —
 * and an interface with no delete verb says that more strongly than a rule.
 *
 * `sweepStaged` is for what abort could not reach: a process that died with
 * an upload in flight. Called at startup, when nothing can be in flight, so
 * everything staged is an orphan.
 *
 * ── Why the firm is a parameter ──────────────────────────────────────────────
 *
 * The key alone would be enough to find the bytes. The firm is passed anyway
 * so an implementation can partition by tenant — a directory per firm here, a
 * folder or bucket prefix per firm elsewhere, and later a per-firm encryption
 * key (docs/threat-model.md, the hosting-provider insider) — and so `open` can
 * refuse a key that was issued to a different firm. The key reached the caller
 * through a row-level-security-scoped query, so that refusal should never
 * fire; it is there for the day something reaches this method another way.
 *
 * ── Residency ────────────────────────────────────────────────────────────────
 *
 * A document's content is the most sensitive asset this platform holds, and
 * it is client data in the sense CLAUDE.md uses: an implementation that puts
 * it outside the Kingdom moves client data out of the Kingdom. That applies to
 * replicas and backups an implementation's provider makes on its own account,
 * not only to the primary copy. Any implementation added here has to answer
 * that before it is wired, not after.
 */
export interface UploadHandle {
  /** Where the bytes go. The caller ends it when the upload has arrived. */
  readonly writable: Writable;

  /** True once `commit` has succeeded. Read by the cleanup that runs when a response ends. */
  readonly committed: boolean;

  /**
   * The staged bytes, for the scanner. Only between the writable finishing
   * and `commit`. A remote implementation that cannot read back what it has
   * not yet committed will need to stage locally first; the scanner has to
   * see the whole file, and it has to see it before the file is a version.
   */
  openStaged(): Readable;

  /**
   * Makes the staged bytes a stored object and returns its key. The content
   * type is the detected one, offered because some backends keep it as
   * metadata. The file name is deliberately not a parameter: it is client
   * data, and a backend that kept it as object metadata would be a second
   * copy outside the database, outside row-level security, and outside the
   * audit trail.
   */
  commit(input: { contentType: string }): Promise<{ key: string }>;

  /**
   * Discards the staged bytes. Idempotent. Must throw after `commit`.
   */
  abort(): Promise<void>;
}

export interface DocumentStorage {
  beginUpload(input: { firmId: string }): Promise<UploadHandle>;

  /**
   * Opens the bytes for reading. Rejects — before any byte is produced — if
   * the key is malformed, was issued to another firm, or names nothing, so the
   * caller can still answer with an error rather than a truncated file.
   */
  open(input: { firmId: string; key: string }): Promise<Readable>;

  /** Removes orphaned staging areas. Returns how many. */
  sweepStaged(): Promise<number>;
}

export const DOCUMENT_STORAGE = Symbol("legal.document-storage");

/**
 * No storage is configured. Uploads and downloads answer 503 rather than
 * pretending; listing still works, since the metadata is in the database.
 */
export class StorageUnavailableError extends Error {
  constructor() {
    super("No document storage is configured for this deployment.");
    this.name = "StorageUnavailableError";
  }
}
