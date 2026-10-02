import { resolve } from "node:path";

/**
 * Evaluated when the module graph loads, so a misconfiguration is a startup
 * failure rather than a surprise on the first upload. Same shape as
 * mail.config.ts, for the same reasons.
 */

const isProduction = process.env["NODE_ENV"] === "production";

const BACKENDS = ["local", "none"] as const;
export type StorageBackend = (typeof BACKENDS)[number];

const raw = process.env["DOCUMENT_STORAGE"];

/**
 * Development defaults to local disk; production must choose, and may not
 * choose `local`. A firm's documents on an application server's own disk are
 * in no place anyone decided on — not in-Kingdom by design, not backed up by
 * design, not encrypted under a key the firm's isolation depends on.
 *
 * `none` is allowed in production because no in-Kingdom store exists yet. It
 * is not silent: uploads and downloads answer 503 with
 * `{ code: "storage_unavailable" }`, and the interface says so.
 */
function resolveBackend(): StorageBackend {
  if (raw === undefined) {
    if (isProduction) {
      throw new Error(
        'DOCUMENT_STORAGE must be set in production. Use "none" until an ' +
          "in-Kingdom store is configured; see " +
          "apps/api/src/documents/storage/document-storage.ts.",
      );
    }
    return "local";
  }

  if (!(BACKENDS as readonly string[]).includes(raw)) {
    throw new Error(
      `DOCUMENT_STORAGE="${raw}" is not a storage backend. Known: ${BACKENDS.join(", ")}.`,
    );
  }

  if (raw === "local" && isProduction) {
    throw new Error(
      "DOCUMENT_STORAGE=local is refused in production: it keeps client " +
        "documents on the application server's own disk.",
    );
  }

  return raw as StorageBackend;
}

/**
 * Where `local` writes. Relative paths resolve against the working directory,
 * which for `pnpm --filter @legal/api run dev` is apps/api — so the default
 * lands in apps/api/.storage/documents, which .gitignore excludes.
 */
const directory = resolve(
  process.env["DOCUMENT_STORAGE_DIR"] ?? ".storage/documents",
);

export const storageConfig = {
  backend: resolveBackend(),
  directory,
} as const;
