import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Readable } from "node:stream";
import type { DocumentStorage } from "./document-storage.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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
 */
export class LocalDiskStorage implements DocumentStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async put(input: {
    firmId: string;
    content: Buffer;
    contentType: string;
  }): Promise<{ key: string }> {
    const firmId = this.checkFirmId(input.firmId);
    const id = randomUUID();
    const directory = join(this.root, firmId);

    // Owner-only. On a shared development machine another account reading
    // the store is the hosting-provider insider in miniature.
    await mkdir(directory, { recursive: true, mode: 0o700 });

    // Written under a temporary name and renamed into place, so a crash
    // mid-write leaves a `.partial` file rather than a truncated one under a
    // key the database might already hold. `wx` refuses to overwrite: a
    // collision on a random uuid is a bug worth hearing about.
    const finalPath = join(directory, id);
    const partialPath = `${finalPath}.partial`;
    await writeFile(partialPath, input.content, { flag: "wx", mode: 0o600 });
    await rename(partialPath, finalPath);

    return { key: `${firmId}/${id}` };
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

  private checkFirmId(firmId: string): string {
    if (!UUID.test(firmId)) {
      throw new Error("LocalDiskStorage: firm id is not a uuid");
    }
    return firmId;
  }
}
