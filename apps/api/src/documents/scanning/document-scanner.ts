import type { Readable } from "node:stream";

/**
 * Malware scanning — the seam, not the scanner. Phase 4 supplies the scanner.
 *
 * ── Where the seam sits ──────────────────────────────────────────────────────
 *
 * After the type check and before the bytes are committed to storage. Type
 * checking is cheap and decisive and refuses most of what a scanner would, so
 * it goes first; the commit comes last so a file the scanner refuses never
 * becomes a stored object, only a staging file that is discarded.
 *
 * The scanner reads the staged bytes as a stream, opened on demand, because
 * the upload is no longer held in memory: a 50 MB file is on disk by the time
 * the scanner sees it, and reading it twice is cheaper than holding it once.
 *
 * Synchronous with the upload, for now. That is the right shape for an
 * in-process or sidecar scanner (ClamAV over a socket answers a 50 MB file in
 * seconds). If Phase 4 chooses an asynchronous scanner instead, the shape
 * changes: a version would exist in a `pending` state, downloads would be
 * refused until it cleared, and that state needs a column — `document_versions`
 * does not have one yet, deliberately, because which shape is needed is
 * Phase 4's decision.
 *
 * ── What happens to what got in unscanned ────────────────────────────────────
 *
 * Every upload's audit entry records the verdict's `status`. Until a scanner
 * is wired that is `not_scanned`, so the backlog Phase 4 has to rescan is a
 * query over the audit log rather than a guess.
 *
 * ── Residency ────────────────────────────────────────────────────────────────
 *
 * A scanner reads the whole document. A cloud scanning API outside the
 * Kingdom is an out-of-Kingdom processor of client documents, exactly as a
 * storage backend would be; the scanner has to run where the documents do.
 */
export type ScanVerdict =
  /** Nothing looked. The only verdict until Phase 4. */
  | { status: "not_scanned" }
  | { status: "clean"; engine: string }
  /** `signature` is the engine's name for what it found; safe to audit. */
  | { status: "infected"; engine: string; signature: string };

export interface ScanInput {
  /** Opens the staged bytes. May be called more than once. */
  open: () => Readable;
  contentType: string;
  sizeBytes: number;
}

export interface DocumentScanner {
  /**
   * Must not throw for an infected file — that is a verdict, not a failure.
   * Throwing means the scanner could not decide, and the upload is refused
   * rather than let through.
   */
  scan(input: ScanInput): Promise<ScanVerdict>;
}

export const DOCUMENT_SCANNER = Symbol("legal.document-scanner");

/** The placeholder: says plainly that nothing was scanned. */
export class NotScanningScanner implements DocumentScanner {
  async scan(): Promise<ScanVerdict> {
    return { status: "not_scanned" };
  }
}
