import type { Readable } from "node:stream";

/**
 * Where a document's bytes live, behind an interface, because the answer is a
 * hosting decision rather than a library.
 *
 * ── What the database knows ──────────────────────────────────────────────────
 *
 * Only the key `put` returns. It is opaque: nothing outside the implementation
 * that issued it may parse it, build a path from it, or turn it into a URL.
 * That is what lets the backing store change — local disk now, a second
 * implementation later — without a migration, and what keeps the rule "every
 * download passes through the API" structural. There is no method here that
 * produces an address a browser could fetch directly, so no code path can hand
 * one out.
 *
 * ── Why the firm is a parameter on both methods ──────────────────────────────
 *
 * The key alone would be enough to find the bytes. The firm is passed anyway
 * so an implementation can partition by tenant — a directory per firm here, a
 * folder or bucket prefix per firm elsewhere, and later a per-firm encryption
 * key (docs/threat-model.md, the hosting-provider insider) — and so `open` can
 * refuse a key that was issued to a different firm. The key reached the caller
 * through a row-level-security-scoped query, so that refusal should never
 * fire; it is there for the day something reaches this method another way.
 *
 * ── What is missing on purpose ───────────────────────────────────────────────
 *
 * No delete. Versions are never destroyed (migration 0018), and an interface
 * without the verb is a stronger statement of that than a convention. The cost
 * is the orphan: if the transaction that records a version fails after `put`
 * succeeded, the bytes stay with nothing pointing at them. The service checks
 * everything it can before writing to make that rare; reclaiming the remainder
 * is a sweep that compares storage against `document_versions`, and is
 * deferred. An unreferenced file is unreachable through the API, so the
 * exposure is the disk, which is the hosting question again.
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
export interface DocumentStorage {
  /**
   * Writes the bytes and returns the key that will find them again. The key is
   * chosen by the implementation, never by the caller, and is never reused.
   *
   * `contentType` is the detected type, offered because some backends store
   * it as metadata. The file name is deliberately not a parameter: it is
   * client data, and a backend that kept it as object metadata would be a
   * second copy of it outside the database, outside row-level security, and
   * outside the audit trail.
   */
  put(input: {
    firmId: string;
    content: Buffer;
    contentType: string;
  }): Promise<{ key: string }>;

  /**
   * Opens the bytes for reading. Rejects — before any byte is produced — if
   * the key is malformed, was issued to another firm, or names nothing, so the
   * caller can still answer with an error rather than a truncated file.
   */
  open(input: { firmId: string; key: string }): Promise<Readable>;
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
