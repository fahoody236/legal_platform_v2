import type { Readable } from "node:stream";
import {
  StorageUnavailableError,
  type DocumentStorage,
} from "./document-storage.js";

/**
 * Stores nothing and says so. For a deployment with no in-Kingdom store
 * configured — the only option production has until one is chosen, since the
 * local implementation is refused there.
 */
export class UnavailableStorage implements DocumentStorage {
  async put(): Promise<{ key: string }> {
    throw new StorageUnavailableError();
  }

  async open(): Promise<Readable> {
    throw new StorageUnavailableError();
  }
}
