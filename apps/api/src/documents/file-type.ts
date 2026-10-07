/**
 * What a file is, decided from its content.
 *
 * ── Three pieces of evidence, one of them believed ───────────────────────────
 *
 * An upload arrives with a name, a type the browser declared, and bytes. The
 * first two are things the uploader says; the third is the thing itself.
 *
 *   * The **extension** is a label anyone can rename. It is checked — it must
 *     name an allowed kind — because it decides what the recipient's computer
 *     does on double-click, and a PDF named `.exe` is dangerous at the far end
 *     whatever it contains. It is not evidence of what the file is.
 *   * The **declared type** is the browser's guess from that same extension.
 *     It is checked only for contradiction: if it names a specific type and
 *     that type disagrees with the content, the upload is refused. Absent or
 *     `application/octet-stream` is not a contradiction — browsers send that
 *     for formats the OS does not know, which includes HEIC on many systems.
 *   * The **content** decides. Each allowed kind has a structural signature
 *     checked at a fixed position, and the extension must name the kind the
 *     content turned out to be.
 *
 * The stored `content_type` is the detected one, from this table, never the
 * declared string. A download therefore serves a type the platform chose.
 *
 * ── What is examined ─────────────────────────────────────────────────────────
 *
 * Not the whole file. Uploads stream to disk, and the check reads a sample:
 * the first 8 KB, where every signature lives, and the last ~1.1 MB, where a
 * zip keeps its central directory. The tail is sized so that any Word or
 * Excel file this code would accept is covered — the directory of a file
 * with the maximum 10,000 parts is under a megabyte, plus the 64 KB a zip
 * comment may occupy after it — so a legitimate file never has its directory
 * outside the sample. A file whose directory does fall outside is refused,
 * which is the same answer it got when the whole file was in memory: more
 * than 10,000 parts was refused then too. Same signatures, same rules, same
 * refusal codes; only where the bytes come from changed.
 *
 * ── Allowed, and why these ───────────────────────────────────────────────────
 *
 * PDF; Word and Excel as OOXML (.docx, .xlsx); JPEG, PNG, WebP, HEIC and TIFF
 * images — HEIC because it is what a phone photographs a court notice in, and
 * TIFF because it is what office scanners produce.
 *
 * **Legacy .doc and .xls are refused.** They are OLE compound files, the same
 * container as `.msi` installers, and the container that carries the macro
 * documents most Office malware still arrives in. Telling a Word 97 document
 * from an installer means walking the compound file's directory, and telling
 * a macro-free one from a macro-bearing one means more than that; a parser
 * for a format whose main present-day use is malware delivery is the wrong
 * thing to write before there is a scanner behind it. Re-saving as .docx or
 * .xlsx is a one-step fix for the uploader. Revisit with Phase 4.
 *
 * **Macro-enabled OOXML is refused**, whatever it is named: a `.docx` with a
 * `vbaProject.bin` inside is a `.docm` wearing a different extension, and
 * macros are executable code.
 *
 * **SVG is refused** although it is an image: it is XML that can carry script,
 * and the case it would need — rendering it inline — is the case this module
 * exists to prevent.
 *
 * Executables are not named anywhere, because they do not need to be. This is
 * an allowlist; anything whose content is not one of the kinds above is
 * refused, whatever it is called.
 *
 * ── What this does not do ────────────────────────────────────────────────────
 *
 * It establishes the container, not that the contents are benign. A PDF with
 * embedded JavaScript is a PDF; a .docx with an embedded OLE package is a
 * .docx. Those are the scanner's to judge (scanning/document-scanner.ts), and
 * downloads are always served as attachments so nothing is rendered on this
 * origin either way.
 */

/** Every signature below sits within the first 12 bytes; 8 KB is generous. */
export const HEAD_BYTES = 8 * 1024;

const MAX_COMMENT_LENGTH = 0xffff;
const EOCD_MIN_LENGTH = 22;
/** Real Office files have dozens of parts; this bounds the work on a hostile one. */
const MAX_ENTRIES = 10_000;

/** Enough tail for a directory of MAX_ENTRIES parts followed by the longest comment. */
export const TAIL_BYTES = 1024 * 1024 + MAX_COMMENT_LENGTH + EOCD_MIN_LENGTH;

/** The parts of a file the check reads. */
export interface FileSample {
  /** The first bytes, up to HEAD_BYTES. */
  head: Buffer;
  /** The last bytes, up to TAIL_BYTES. The whole file when it is smaller. */
  tail: Buffer;
  /** The file's full length. */
  size: number;
}

/** A sample of a file held entirely in memory. */
export function sampleOf(content: Buffer): FileSample {
  return {
    head: content.subarray(0, HEAD_BYTES),
    tail: content.subarray(Math.max(0, content.length - TAIL_BYTES)),
    size: content.length,
  };
}

export const ALLOWED_KINDS = [
  "pdf",
  "docx",
  "xlsx",
  "jpeg",
  "png",
  "webp",
  "heic",
  "tiff",
] as const;

export type DocumentKind = (typeof ALLOWED_KINDS)[number];

interface KindSpec {
  /** What is stored and served. */
  contentType: string;
  extensions: readonly string[];
  /** Declared types that agree with this kind. */
  declared: readonly string[];
}

/** Browsers on systems without Office installed declare OOXML as plain zip. */
const ZIP_DECLARED = ["application/zip", "application/x-zip-compressed"];

const KINDS: Record<DocumentKind, KindSpec> = {
  pdf: {
    contentType: "application/pdf",
    extensions: ["pdf"],
    declared: ["application/pdf", "application/x-pdf"],
  },
  docx: {
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extensions: ["docx"],
    declared: [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ...ZIP_DECLARED,
    ],
  },
  xlsx: {
    contentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    extensions: ["xlsx"],
    declared: [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ...ZIP_DECLARED,
    ],
  },
  jpeg: {
    contentType: "image/jpeg",
    extensions: ["jpg", "jpeg"],
    declared: ["image/jpeg", "image/jpg", "image/pjpeg"],
  },
  png: {
    contentType: "image/png",
    extensions: ["png"],
    declared: ["image/png"],
  },
  webp: {
    contentType: "image/webp",
    extensions: ["webp"],
    declared: ["image/webp"],
  },
  heic: {
    contentType: "image/heic",
    extensions: ["heic", "heif"],
    declared: ["image/heic", "image/heif"],
  },
  tiff: {
    contentType: "image/tiff",
    extensions: ["tif", "tiff"],
    declared: ["image/tiff"],
  },
};

/** For the interface's `accept` attribute and its own pre-check. */
export const ALLOWED_EXTENSIONS: readonly string[] = ALLOWED_KINDS.flatMap(
  (kind) => KINDS[kind].extensions,
);

/** Declared types that say nothing, as opposed to saying something wrong. */
const UNINFORMATIVE_DECLARED = new Set(["", "application/octet-stream"]);

export type InspectionFailure =
  /** The extension is not one this platform accepts. */
  | "unsupported_type"
  /** The extension or declared type says one thing and the content another. */
  | "type_mismatch"
  /** OOXML carrying a VBA project. */
  | "macro_enabled";

export type Inspection =
  | { ok: true; kind: DocumentKind; contentType: string }
  | { ok: false; reason: InspectionFailure };

export function extensionOf(fileName: string): string | undefined {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0 || dot === fileName.length - 1) {
    return undefined;
  }
  return fileName.slice(dot + 1).toLowerCase();
}

function kindForExtension(extension: string | undefined): DocumentKind | undefined {
  if (!extension) return undefined;
  return ALLOWED_KINDS.find((kind) =>
    KINDS[kind].extensions.includes(extension),
  );
}

/**
 * Decides whether this file, under this name and declared type, may be
 * stored — and as what.
 *
 * Order matters only for which reason is reported: extension first, because
 * "we don't accept .exe" is the most useful thing to tell someone who tried.
 */
export function inspectFile(input: {
  fileName: string;
  declaredType: string;
  sample: FileSample;
}): Inspection {
  const claimed = kindForExtension(extensionOf(input.fileName));

  if (!claimed) {
    return { ok: false, reason: "unsupported_type" };
  }

  const detected = detectKind(input.sample);

  if (detected.kind === undefined) {
    return {
      ok: false,
      reason: detected.macros ? "macro_enabled" : "type_mismatch",
    };
  }

  if (detected.kind !== claimed) {
    return { ok: false, reason: "type_mismatch" };
  }

  // Parameters such as `; charset=…` are not part of the type.
  const declared = (input.declaredType.split(";")[0] ?? "").trim().toLowerCase();

  if (
    !UNINFORMATIVE_DECLARED.has(declared) &&
    !KINDS[detected.kind].declared.includes(declared)
  ) {
    return { ok: false, reason: "type_mismatch" };
  }

  return {
    ok: true,
    kind: detected.kind,
    contentType: KINDS[detected.kind].contentType,
  };
}

function startsWith(content: Buffer, bytes: readonly number[], at = 0): boolean {
  if (content.length < at + bytes.length) return false;
  return bytes.every((byte, index) => content[at + index] === byte);
}

function ascii(content: Buffer, at: number, length: number): string {
  if (content.length < at + length) return "";
  return content.toString("latin1", at, at + length);
}

/**
 * The kind the content is, by structure. `macros` is set when the content is
 * OOXML that would otherwise have passed, so the caller can say why.
 */
function detectKind(sample: FileSample): {
  kind: DocumentKind | undefined;
  macros?: boolean;
} {
  const { head } = sample;

  // `%PDF-` at byte zero. Readers tolerate junk in the first kilobyte; this
  // does not, because that tolerance is what PDF polyglots are built on.
  if (ascii(head, 0, 5) === "%PDF-") return { kind: "pdf" };

  if (startsWith(head, [0xff, 0xd8, 0xff])) return { kind: "jpeg" };

  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { kind: "png" };
  }

  if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 4) === "WEBP") {
    return { kind: "webp" };
  }

  // Little- and big-endian TIFF headers.
  if (
    startsWith(head, [0x49, 0x49, 0x2a, 0x00]) ||
    startsWith(head, [0x4d, 0x4d, 0x00, 0x2a])
  ) {
    return { kind: "tiff" };
  }

  // ISO base media: a box size, then `ftyp`, then the major brand.
  if (ascii(head, 4, 4) === "ftyp") {
    const brand = ascii(head, 8, 4);
    if (["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(brand)) {
      return { kind: "heic" };
    }
    return { kind: undefined };
  }

  // A local file header at byte zero. Checked here rather than left to the
  // zip parser, so that a self-extracting archive — an executable with a zip
  // appended, whose central directory parses perfectly — is refused.
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04])) {
    return detectOoxml(sample);
  }

  return { kind: undefined };
}

/**
 * Word or Excel, from the archive's directory.
 *
 * An OOXML file is a zip, and so is a .jar, an .apk, and a zip of
 * executables, so the magic number settles nothing. What distinguishes them
 * is the part names in the central directory: `[Content_Types].xml` for any
 * OOXML package, and the main part — `word/document.xml` or
 * `xl/workbook.xml` — for which application it belongs to.
 *
 * Nothing is decompressed. Part names are stored uncompressed in the central
 * directory, which is all this reads, so a zip bomb costs nothing here.
 */
function detectOoxml(sample: FileSample): {
  kind: DocumentKind | undefined;
  macros?: boolean;
} {
  const names = centralDirectoryNames(sample.tail, sample.size);

  if (!names || !names.has("[Content_Types].xml")) {
    return { kind: undefined };
  }

  const isWord = names.has("word/document.xml");
  const isExcel = names.has("xl/workbook.xml");

  // Both main parts is not a document anyone's software produced.
  if (isWord === isExcel) {
    return { kind: undefined };
  }

  for (const name of names) {
    if (/(^|\/)vbaProject\.bin$/i.test(name)) {
      return { kind: undefined, macros: true };
    }
  }

  return { kind: isWord ? "docx" : "xlsx" };
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_ENTRY_SIGNATURE = 0x02014b50;

/**
 * The part names in a zip's central directory, or undefined if the archive is
 * not one this will vouch for.
 *
 * `tail` is the last `tail.length` bytes of a file `fileSize` long; offsets
 * in the zip are absolute, so each is translated before use, and a directory
 * that begins before the tail is refused as out of reach.
 *
 * Strict where strictness is free. The central directory must end exactly
 * where the end-of-central-directory record begins, so nothing can be hidden
 * between them; multi-disk and zip64 archives are refused, since no Office
 * document under 50 MB is either; every length is bounds-checked against the
 * sample before it is used.
 */
function centralDirectoryNames(
  tail: Buffer,
  fileSize: number,
): Set<string> | undefined {
  if (tail.length < EOCD_MIN_LENGTH || tail.length > fileSize) return undefined;

  const tailStart = fileSize - tail.length;

  // The end record sits at the end, followed only by its own comment, so it
  // is found by scanning backwards over at most the longest comment.
  const searchFloor = Math.max(
    0,
    tail.length - EOCD_MIN_LENGTH - MAX_COMMENT_LENGTH,
  );
  let eocd = -1;

  for (let at = tail.length - EOCD_MIN_LENGTH; at >= searchFloor; at -= 1) {
    if (
      tail.readUInt32LE(at) === EOCD_SIGNATURE &&
      at + EOCD_MIN_LENGTH + tail.readUInt16LE(at + 20) === tail.length
    ) {
      eocd = at;
      break;
    }
  }

  if (eocd < 0) return undefined;

  const disk = tail.readUInt16LE(eocd + 4);
  const directoryDisk = tail.readUInt16LE(eocd + 6);
  const entriesOnDisk = tail.readUInt16LE(eocd + 8);
  const entries = tail.readUInt16LE(eocd + 10);
  const directorySize = tail.readUInt32LE(eocd + 12);
  const directoryOffset = tail.readUInt32LE(eocd + 16);

  if (disk !== 0 || directoryDisk !== 0 || entriesOnDisk !== entries) {
    return undefined;
  }

  if (
    entries === 0xffff ||
    directorySize === 0xffffffff ||
    directoryOffset === 0xffffffff
  ) {
    return undefined;
  }

  if (entries === 0 || entries > MAX_ENTRIES) return undefined;
  if (directoryOffset + directorySize !== tailStart + eocd) return undefined;
  if (directoryOffset < tailStart) return undefined;

  const names = new Set<string>();
  let at = directoryOffset - tailStart;

  for (let index = 0; index < entries; index += 1) {
    if (at + 46 > eocd) return undefined;
    if (tail.readUInt32LE(at) !== CENTRAL_ENTRY_SIGNATURE) return undefined;

    const nameLength = tail.readUInt16LE(at + 28);
    const extraLength = tail.readUInt16LE(at + 30);
    const commentLength = tail.readUInt16LE(at + 32);
    const next = at + 46 + nameLength + extraLength + commentLength;

    if (next > eocd) return undefined;

    names.add(tail.toString("utf8", at + 46, at + 46 + nameLength));
    at = next;
  }

  return at === eocd ? names : undefined;
}
