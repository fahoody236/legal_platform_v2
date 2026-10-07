import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rename, stat, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Readable, Writable } from "node:stream";
import type { DocumentStorage, UploadHandle } from "./document-storage.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * A staging file's suffix. Load-bearing: `abort` will only ever unlink a path
 * that ends in it, and `sweepStaged` only ever matches on it.
 */
const STAGED_SUFFIX = ".partial";

/**
 * Bytes on the local filesystem, one directory per firm. Development only:
 * storage.config.ts refuses it under NODE_ENV=production.
 *
 * Refused there not because the code is wrong but because the property that
 * matters cannot be stated for it. A file on a server's disk is wherever that
 * server is, is backed up by whatever backs up that disk, and is gone when the
 * instance is replaced. None of that is a decision anyone made.
 *
 * Keys are `<firmId>/<uuid>`. That this implementation can read the firm back
 * out of a key is its own business; callers treat the key as opaque.
 *
 * An upload is written to `<uuid>.partial` and renamed into place on commit,
 * so a crash mid-write leaves a `.partial` — which the startup sweep removes
 * — rather than a truncated file under a key the database might hold.
 */
export class LocalDiskStorage implements DocumentStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async beginUpload(input: { firmId: string }): Promise<UploadHandle> {
    const firmId = this.checkFirmId(input.firmId);
    const directory = join(this.root, firmId);

    // Owner-only. On a shared development machine another account reading
    // the store is the hosting-provider insider in miniature.
    await mkdir(directory, { recursive: true, mode: 0o700 });

    const id = randomUUID();
    const finalPath = join(directory, id);
    const stagedPath = `${finalPath}${STAGED_SUFFIX}`;

    // `wx` refuses to overwrite: a collision on a random uuid is a bug worth
    // hearing about, not a file worth replacing.
    const writable = createWriteStream(stagedPath, { flags: "wx", mode: 0o600 });

    return new LocalUploadHandle(writable, stagedPath, finalPath, `${firmId}/${id}`);
  }

  async open(input: { firmId: string; key: string }): Promise<Readable> {
    const firmId = this.checkFirmId(input.firmId);
    const [keyFirm, id, ...rest] = input.key.split("/");

    // Parsed strictly rather than joined and normalised. A key is two uuids
    // and nothing else, so there is no `..` or absolute path to defend against
    // — anything that is not that shape is refused before it nears the disk.
    if (rest.length > 0 || !keyFirm || !id || !UUID.test(keyFirm) || !UUID.test(id)) {
      throw new Error("LocalDiskStorage: malformed storage key");
    }

    if (keyFirm !== firmId) {
      throw new Error("LocalDiskStorage: storage key belongs to another firm");
    }

    const path = join(this.root, keyFirm, id);

    // Checked before the stream is created so a missing file is a rejected
    // promise here — while the caller can still send an error status — rather
    // than an error event after the response headers have gone.
    const info = await stat(path);
    if (!info.isFile()) {
      throw new Error("LocalDiskStorage: storage key does not name a file");
    }

    return createReadStream(path);
  }

  /**
   * Every `.partial` under every firm directory, removed. Only files with
   * that suffix are so much as looked at; a committed object is a bare uuid
   * and does not match.
   */
  async sweepStaged(): Promise<number> {
    let removed = 0;
    let firms: string[];

    try {
      firms = await readdir(this.root);
    } catch (error) {
      if (isMissing(error)) return 0;
      throw error;
    }

    for (const firm of firms) {
      if (!UUID.test(firm)) continue;

      const directory = join(this.root, firm);
      let entries: string[];

      try {
        entries = await readdir(directory);
      } catch (error) {
        if (isMissing(error)) continue;
        throw error;
      }

      for (const entry of entries) {
        if (!entry.endsWith(STAGED_SUFFIX)) continue;
        await unlink(join(directory, entry));
        removed += 1;
      }
    }

    return removed;
  }

  private checkFirmId(firmId: string): string {
    if (!UUID.test(firmId)) {
      throw new Error("LocalDiskStorage: firm id is not a uuid");
    }
    return firmId;
  }
}

/**
 * One upload's staging file.
 *
 * `abort` is bounded two ways, neither of them a convention. The path it
 * unlinks is the staged path, a private field this class alone wrote, and it
 * is asserted to end in `.partial` before any unlink. And once `commit` has
 * renamed the file into place, `abort` throws: the handle's own state says
 * there is no staging file any more, and the committed object is reachable
 * only by a key this handle does not use.
 */
class LocalUploadHandle implements UploadHandle {
  private state: "staging" | "committed" | "aborted" = "staging";

  constructor(
    readonly writable: Writable,
    private readonly stagedPath: string,
    private readonly finalPath: string,
    private readonly key: string,
  ) {}

  get committed(): boolean {
    return this.state === "committed";
  }

  openStaged(): Readable {
    if (this.state !== "staging") {
      throw new Error(`LocalUploadHandle: cannot read staged bytes when ${this.state}`);
    }
    if (!this.writable.writableFinished) {
      throw new Error("LocalUploadHandle: upload has not finished arriving");
    }
    return createReadStream(this.stagedPath);
  }

  async commit(): Promise<{ key: string }> {
    if (this.state !== "staging") {
      throw new Error(`LocalUploadHandle: commit when ${this.state}`);
    }
    if (!this.writable.writableFinished) {
      throw new Error("LocalUploadHandle: commit before the upload finished arriving");
    }

    await rename(this.stagedPath, this.finalPath);
    this.state = "committed";
    return { key: this.key };
  }

  async abort(): Promise<void> {
    if (this.state === "committed") {
      throw new Error("LocalUploadHandle: abort after commit is refused");
    }
    if (this.state === "aborted") {
      return;
    }
    if (!this.stagedPath.endsWith(STAGED_SUFFIX)) {
      throw new Error("LocalUploadHandle: refusing to remove a non-staged path");
    }

    this.state = "aborted";

    if (!this.writable.destroyed) {
      this.writable.destroy();
    }

    try {
      await unlink(this.stagedPath);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
}

function isMissing(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "ENOENT";
}
