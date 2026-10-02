import { createHash } from "node:crypto";
import type { ServerResponse } from "node:http";
import { Transform, type TransformCallback } from "node:stream";
import type { DocumentVersion } from "@legal/db";

/**
 * Passes bytes through while hashing them, and withholds the last chunk until
 * the hash is known to match.
 *
 * The withholding is the point. A plain hashing pass-through would discover a
 * mismatch only after every byte had been written to the socket — too late to
 * do anything but log it, and the recipient would hold a complete, altered
 * file that looked like the original. Holding one chunk back means a mismatch
 * ends the response short of its Content-Length, which every client treats as
 * a failed transfer: the browser's fetch rejects, and the interface never
 * offers the file to save.
 *
 * Also refuses a stream that is longer or shorter than the recorded size,
 * which is a cheaper signal of the same fault.
 */
export class VerifyingStream extends Transform {
  private readonly hash = createHash("sha256");
  private held: Buffer | undefined;
  private seen = 0;

  constructor(
    private readonly expectedChecksum: string,
    private readonly expectedSize: number,
  ) {
    super();
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    this.hash.update(chunk);
    this.seen += chunk.length;

    if (this.seen > this.expectedSize) {
      callback(new Error("Stored document is longer than its recorded size"));
      return;
    }

    const previous = this.held;
    this.held = chunk;
    callback(null, previous);
  }

  override _flush(callback: TransformCallback): void {
    const actual = `sha256:${this.hash.digest("hex")}`;

    if (this.seen !== this.expectedSize || actual !== this.expectedChecksum) {
      callback(
        new Error(
          "Stored document does not match its recorded checksum; refusing to " +
            "complete the download",
        ),
      );
      return;
    }

    callback(null, this.held);
  }
}

/**
 * `Content-Disposition` carrying an Arabic file name.
 *
 * `filename*` (RFC 6266 / RFC 5987) is the real name, UTF-8 and percent-
 * encoded, which every current browser reads. `filename` is the fallback for
 * clients that do not: ASCII only, with anything else replaced — and if
 * nothing ASCII is left, which for an Arabic name is the usual case, a
 * neutral name built from the version, so the fallback is never `____.pdf`.
 *
 * Always `attachment`, never `inline`. An inline PDF or image would be
 * rendered by the browser on this origin, beside the session cookie; as an
 * attachment it is a file handed over, and whatever it contains runs, if at
 * all, somewhere else.
 */
export function contentDisposition(version: DocumentVersion): string {
  const encoded = encodeURIComponent(version.fileName).replace(
    /['()*]/g,
    (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  const dot = version.fileName.lastIndexOf(".");
  const extension = dot > 0 ? version.fileName.slice(dot) : "";
  const asciiStem = version.fileName
    .slice(0, dot > 0 ? dot : undefined)
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/["\\]/g, "")
    .trim();
  const fallback = asciiStem
    ? `${asciiStem}${extension}`
    : `document-v${version.versionNumber}${extension}`;

  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/**
 * Headers for a download. Everything here narrows what the browser may do
 * with the response: take it as the declared type and nothing else, keep no
 * copy, render nothing.
 */
export function writeDownloadHeaders(
  response: ServerResponse,
  version: DocumentVersion,
): void {
  response.statusCode = 200;
  response.setHeader("Content-Type", version.contentType);
  response.setHeader("Content-Length", String(version.sizeBytes));
  response.setHeader("Content-Disposition", contentDisposition(version));
  // The detected type is the only type. Without this a browser may sniff the
  // bytes and decide they are HTML.
  response.setHeader("X-Content-Type-Options", "nosniff");
  // A shared machine's browser cache is a copy of a client document outside
  // the audit trail. `private` keeps it out of any proxy, `no-store` out of
  // the cache.
  response.setHeader("Cache-Control", "private, no-store");
  // Belt and braces with `attachment`: if anything does render this response,
  // it renders sandboxed, with nothing allowed to load.
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; sandbox",
  );
}
