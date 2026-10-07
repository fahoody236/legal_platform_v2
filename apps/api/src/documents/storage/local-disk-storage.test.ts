import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { finished } from "node:stream/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalDiskStorage } from "./local-disk-storage.js";

const firm = "aaaaaaaa-0000-4000-8000-000000000001";

let root: string;
let storage: LocalDiskStorage;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "legal-storage-"));
  storage = new LocalDiskStorage(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function stage(bytes: string) {
  const handle = await storage.beginUpload({ firmId: firm });
  handle.writable.end(bytes);
  await finished(handle.writable);
  return handle;
}

async function entries() {
  return (await readdir(join(root, firm))).sort();
}

describe("LocalDiskStorage upload handles", () => {
  it("stages under .partial and commits by rename", async () => {
    const handle = await stage("hello");
    expect(await entries()).toEqual([expect.stringMatching(/\.partial$/)]);

    const { key } = await handle.commit({ contentType: "application/pdf" });
    expect(key).toMatch(new RegExp(`^${firm}/[0-9a-f-]{36}$`));
    expect(await entries()).toEqual([key.split("/")[1]]);
    expect(handle.committed).toBe(true);

    const stream = await storage.open({ firmId: firm, key });
    let read = "";
    for await (const chunk of stream) read += String(chunk);
    expect(read).toBe("hello");
  });

  it("abort removes the staging file and is idempotent", async () => {
    const handle = await stage("bytes");
    await handle.abort();
    await handle.abort();
    expect(await entries()).toEqual([]);
  });

  /**
   * The property the storage layer enforces rather than leaves to callers: a
   * committed object cannot be removed through a handle, however the handle
   * is used afterwards.
   */
  it("abort after commit is refused and the committed file survives", async () => {
    const handle = await stage("keep me");
    const { key } = await handle.commit({ contentType: "application/pdf" });

    await expect(handle.abort()).rejects.toThrow(/after commit/);
    expect(await entries()).toEqual([key.split("/")[1]]);
  });

  it("commit after abort is refused", async () => {
    const handle = await stage("gone");
    await handle.abort();
    await expect(handle.commit({ contentType: "application/pdf" })).rejects.toThrow();
  });

  it("commit before the stream has finished is refused", async () => {
    const handle = await storage.beginUpload({ firmId: firm });
    handle.writable.write("partial");
    await expect(handle.commit({ contentType: "application/pdf" })).rejects.toThrow(
      /finished/,
    );
    handle.writable.end();
    await finished(handle.writable);
    await handle.abort();
  });

  it("the staged bytes can be read back before commit, for the scanner", async () => {
    const handle = await stage("scan me");
    let read = "";
    for await (const chunk of handle.openStaged()) read += String(chunk);
    expect(read).toBe("scan me");
    await handle.abort();
  });
});

describe("LocalDiskStorage.sweepStaged", () => {
  it("removes every .partial and nothing else", async () => {
    const kept = await stage("kept");
    const { key } = await kept.commit({ contentType: "application/pdf" });

    // Orphans as a crashed process would leave them, in two firm directories.
    const otherFirm = "bbbbbbbb-0000-4000-8000-000000000001";
    await writeFile(join(root, firm, `${randomUUID()}.partial`), "x");
    await writeFile(join(root, firm, `${randomUUID()}.partial`), "y");
    await (await import("node:fs/promises")).mkdir(join(root, otherFirm));
    await writeFile(join(root, otherFirm, `${randomUUID()}.partial`), "z");
    // A stray that matches neither shape is left alone, not guessed about.
    await writeFile(join(root, firm, "notes.txt"), "?");

    expect(await storage.sweepStaged()).toBe(3);
    expect(await entries()).toEqual([key.split("/")[1], "notes.txt"].sort());
    expect(await readdir(join(root, otherFirm))).toEqual([]);
  });

  it("is a no-op on a root that does not exist yet", async () => {
    const fresh = new LocalDiskStorage(join(root, "never-created"));
    expect(await fresh.sweepStaged()).toBe(0);
  });
});
