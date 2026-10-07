import type { Readable } from "node:stream";
import {
  StorageUnavailableError,
  type DocumentStorage,
  type UploadHandle,
} from "./document-storage.js";

/**
 * Stores nothing and says so. For a deployment with no in-Kingdom store
 * configured — the only option production has until one is chosen, since the
 * local implementation is refused there.
 */
export class UnavailableStorage implements DocumentStorage {
  async beginUpload(): Promise<UploadHandle> {
    throw new StorageUnavailableError();
  }

  async open(): Promise<Readable> {
    throw new StorageUnavailableError();
  }

  async sweepStaged(): Promise<number> {
    return 0;
  }
}
