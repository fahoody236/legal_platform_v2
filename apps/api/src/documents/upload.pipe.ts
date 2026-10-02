import { createHash } from "node:crypto";
import {
  BadRequestException,
  UnsupportedMediaTypeException,
  type PipeTransform,
} from "@nestjs/common";
import { inspectFile, type DocumentKind } from "./file-type.js";

/**
 * 50 MB, in bytes. Enforced by multer while the request streams in (413 the
 * moment the limit is passed, without buffering the rest) and asserted again
 * here, so the limit holds even if the interceptor's options are ever lost.
 */
export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;

/** The subset of multer's file object this reads. */
export interface ReceivedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** An upload that has passed every check that does not need the database. */
export interface InspectedUpload {
  fileName: string;
  kind: DocumentKind;
  contentType: string;
  sizeBytes: number;
  /** `sha256:<hex>` of the bytes as received. */
  checksum: string;
  content: Buffer;
}

/**
 * Characters removed from a file name before it is stored or shown.
 *
 * The bidirectional controls are the ones that matter on an Arabic-first
 * platform: U+202E (RIGHT-TO-LEFT OVERRIDE) placed before `fdp.exe` makes
 * the name *display* as ending `exe.pdf`. The extension check reads the
 * real characters, so such a file is refused regardless — but the name is
 * also shown in lists and offered as a download name, and nothing displayed
 * on this platform should be able to lie about its own order. The isolates
 * (U+2066–2069) and marks (U+200E, U+200F, U+061C) go too: a file name has no
 * legitimate use for them that is worth the ambiguity.
 */
const BIDI_CONTROLS = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
// Control characters, including NUL, newline and DEL: header injection on the
// way back out in Content-Disposition, and terminal escapes in any log.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
const MAX_FILE_NAME_LENGTH = 200;

/**
 * The name to store: the last path segment, normalised, without controls,
 * and short enough to be a file name on any system it is downloaded to.
 * Undefined when nothing usable remains.
 */
export function cleanFileName(raw: string): string | undefined {
  const base = raw.split(/[/\\]/).pop() ?? "";
  const cleaned = base
    .normalize("NFC")
    .replace(BIDI_CONTROLS, "")
    .replace(CONTROL, "")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned === "" || /^\.+$/.test(cleaned)) {
    return undefined;
  }

  if (cleaned.length <= MAX_FILE_NAME_LENGTH) {
    return cleaned;
  }

  // Shortened from the middle of the stem, keeping the extension: the type
  // check reads the extension, and a name cut through it would change what
  // the file is.
  const dot = cleaned.lastIndexOf(".");
  const extension = dot > 0 ? cleaned.slice(dot) : "";
  return cleaned.slice(0, MAX_FILE_NAME_LENGTH - extension.length) + extension;
}

/**
 * Checks the uploaded file and turns it into an `InspectedUpload`, or refuses
 * the request.
 *
 * At the boundary, like ZodValidationPipe: a service receiving an
 * InspectedUpload can treat its type and size as established. The refusals
 * carry a `code` because the interface must word them differently — "too
 * large", "not a type we accept" and "macros" are three different things to
 * fix.
 */
export class DocumentUploadPipe
  implements PipeTransform<ReceivedFile | undefined, InspectedUpload>
{
  transform(file: ReceivedFile | undefined): InspectedUpload {
    if (!file) {
      throw new BadRequestException({ code: "file_missing" });
    }

    if (file.size === 0 || file.buffer.length === 0) {
      throw new BadRequestException({ code: "file_empty" });
    }

    if (file.buffer.length > MAX_DOCUMENT_BYTES) {
      // Unreachable while multer's limit is in place; see MAX_DOCUMENT_BYTES.
      throw new BadRequestException({ code: "file_too_large" });
    }

    const fileName = cleanFileName(file.originalname);

    if (!fileName) {
      throw new BadRequestException({ code: "file_name_invalid" });
    }

    const inspection = inspectFile({
      fileName,
      declaredType: file.mimetype,
      content: file.buffer,
    });

    if (!inspection.ok) {
      throw new UnsupportedMediaTypeException({ code: inspection.reason });
    }

    return {
      fileName,
      kind: inspection.kind,
      contentType: inspection.contentType,
      sizeBytes: file.buffer.length,
      checksum: `sha256:${createHash("sha256").update(file.buffer).digest("hex")}`,
      content: file.buffer,
    };
  }
}
