import { createHash, randomBytes } from "node:crypto";
import { PassThrough, Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { describe, expect, it } from "vitest";
import { inspectFile, sampleOf, TAIL_BYTES, type Inspection } from "./file-type.js";
import { SamplingHasher } from "./upload-engine.js";

/**
 * A store-only zip, built by hand, so the OOXML checks run against real
 * central directories without a zip library in the test.
 */
function zip(parts: Record<string, string>, options: { comment?: string; prefix?: Buffer } = {}): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = options.prefix?.length ?? 0;

  for (const [name, body] of Object.entries(parts)) {
    const nameBytes = Buffer.from(name, "utf8");
    const data = Buffer.from(body, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, data);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }

  const directory = Buffer.concat(central);
  const comment = Buffer.from(options.comment ?? "", "utf8");
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(central.length / 2, 8);
  eocd.writeUInt16LE(central.length / 2, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(comment.length, 20);

  return Buffer.concat([options.prefix ?? Buffer.alloc(0), ...locals, directory, eocd, comment]);
}

const docx = (extra: Record<string, string> = {}) =>
  zip({ "[Content_Types].xml": "<Types/>", "word/document.xml": "<w/>", ...extra });
const xlsx = () => zip({ "[Content_Types].xml": "<Types/>", "xl/workbook.xml": "<wb/>" });
const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF\n");

function inspect(fileName: string, content: Buffer, declaredType = ""): Inspection {
  return inspectFile({ fileName, declaredType, sample: sampleOf(content) });
}

describe("inspectFile: the Phase 3 cases, by the same codes", () => {
  it("accepts the allowed kinds and stores the detected type", () => {
    expect(inspect("عقد.pdf", pdf, "application/pdf")).toMatchObject({ ok: true, kind: "pdf" });
    expect(inspect("memo.docx", docx())).toMatchObject({
      ok: true,
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    expect(inspect("book.xlsx", xlsx(), "application/zip")).toMatchObject({ ok: true, kind: "xlsx" });
    expect(
      inspect("scan.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])),
    ).toMatchObject({ ok: true, kind: "png" });
    expect(inspect("photo.jpg", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toMatchObject({ kind: "jpeg" });
  });

  it("macro_enabled: a docx carrying vbaProject.bin", () => {
    expect(inspect("macro.docx", docx({ "word/vbaProject.bin": "ÐÏ" }))).toEqual({
      ok: false,
      reason: "macro_enabled",
    });
  });

  it("type_mismatch: an executable named .pdf", () => {
    const exe = Buffer.concat([Buffer.from("MZ\x90\x00"), Buffer.alloc(200)]);
    expect(inspect("fake.pdf", exe, "application/pdf")).toEqual({ ok: false, reason: "type_mismatch" });
  });

  it("type_mismatch: a self-extracting archive, zip appended to an executable", () => {
    const prefix = Buffer.concat([Buffer.from("MZ\x90\x00"), Buffer.alloc(100)]);
    const sfx = zip({ "[Content_Types].xml": "x", "word/document.xml": "y" }, { prefix });
    expect(inspect("sfx.docx", sfx)).toEqual({
      ok: false,
      reason: "type_mismatch",
    });
  });

  it("unsupported_type: svg and txt by extension, before content is looked at", () => {
    expect(inspect("pic.svg", Buffer.from("<svg/>"), "image/svg+xml")).toEqual({ ok: false, reason: "unsupported_type" });
    expect(inspect("note.txt", Buffer.from("hi"))).toEqual({ ok: false, reason: "unsupported_type" });
    expect(inspect("old.doc", Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))).toEqual({ ok: false, reason: "unsupported_type" });
  });

  it("type_mismatch: the declared type contradicts the content", () => {
    expect(inspect("memo.docx", docx(), "application/pdf")).toEqual({ ok: false, reason: "type_mismatch" });
  });

  it("type_mismatch: a zip that is not an Office package, or is both", () => {
    expect(inspect("x.docx", zip({ "a.exe": "MZ" }))).toEqual({ ok: false, reason: "type_mismatch" });
    expect(
      inspect("x.docx", zip({ "[Content_Types].xml": "", "word/document.xml": "", "xl/workbook.xml": "" })),
    ).toEqual({ ok: false, reason: "type_mismatch" });
  });

  it("a zip comment does not hide the directory", () => {
    const commented = zip(
      { "[Content_Types].xml": "<Types/>", "word/document.xml": "<w/>" },
      { comment: "x".repeat(3000) },
    );
    expect(inspect("memo.docx", commented)).toMatchObject({ ok: true, kind: "docx" });
  });
});

describe("the sample from a stream equals the sample from the whole file", () => {
  async function streamed(content: Buffer, chunk: number) {
    const hasher = new SamplingHasher();
    const sink = new PassThrough();
    sink.resume();
    const source = Readable.from(
      (function* () {
        for (let at = 0; at < content.length; at += chunk) {
          yield content.subarray(at, at + chunk);
        }
      })(),
    );
    await pipeline(source, hasher, sink);
    return hasher;
  }

  it("for a file larger than the tail, in odd chunk sizes", async () => {
    // A real docx whose stored content pushes the directory past the head
    // and the file past the tail, so both samples are genuine excerpts.
    const big = docx({
      "word/media/image1.bin": randomBytes(TAIL_BYTES / 2 + 100_000).toString("latin1"),
    });
    expect(big.length).toBeGreaterThan(TAIL_BYTES);

    for (const chunk of [7, 4096, 65_536, 1_000_003]) {
      const hasher = await streamed(big, chunk);
      const whole = sampleOf(big);

      expect(hasher.size).toBe(big.length);
      expect(hasher.head().equals(whole.head), `head, chunk ${chunk}`).toBe(true);
      expect(hasher.tail().equals(whole.tail), `tail, chunk ${chunk}`).toBe(true);
      expect(hasher.checksum()).toBe(`sha256:${createHash("sha256").update(big).digest("hex")}`);

      const inspection = inspectFile({
        fileName: "big.docx",
        declaredType: "",
        sample: { head: hasher.head(), tail: hasher.tail(), size: hasher.size },
      });
      expect(inspection).toMatchObject({ ok: true, kind: "docx" });
    }
  });

  it("for a file smaller than the head", async () => {
    const hasher = await streamed(pdf, 3);
    expect(hasher.head().equals(pdf)).toBe(true);
    expect(hasher.tail().equals(pdf)).toBe(true);
  });
});
