# 0006 — Documents: storage behind a seam, every byte through the API

Status: Accepted — 2026-10-03

## Context

Case documents are the highest-sensitivity asset in docs/threat-model.md: privilege cannot be un-waived. Two
of its adversaries are about documents specifically. One is the departing employee, who is entitled to see
the file but should not be able to carry it out unrecorded. The other is the opposing party, who argues that
the record was altered.

## Model

`documents` is the entry in a matter's file and persists across revisions. `document_versions` is one upload
of bytes against it, and is append-only: the application role holds `SELECT` and `INSERT` and nothing else
(migration 0018). There is no current-version pointer; the current version is the highest `version_number`.
A new version locks its document row (`SELECT … FOR UPDATE`) so that concurrent uploads are numbered in
sequence rather than colliding.

## Storage

`DocumentStorage` has two methods: `put(firmId, bytes) → key` and `open(firmId, key) → stream`. It has no
delete and no method that yields a URL. The database stores the key and treats it as opaque.

Both methods take the firm, so an implementation can partition by tenant and refuse a key issued to another
firm. That refusal is defence in depth; RLS has already scoped the row the key came from.

`local` writes to disk and is for development. It is refused under `NODE_ENV=production`, as the console
mailer is. `none` answers 503 `storage_unavailable` and is what production runs until an in-Kingdom store is
chosen.

**Google Drive, as the planned second implementation, has a precondition.** Document content is client data,
so wherever Drive keeps it at rest must be in-Kingdom, and that includes the replicas and backups Google makes
on its own account. Google Workspace data regions are not the same product as Google Cloud's Dammam region,
so this needs confirming for the specific account before anything is wired, not assuming. Drive also brings
its own sharing model. The files would have to be owned by a service account and never shared, because a Drive
share link is a download path that neither the permission check nor the audit log can see.

## Type checking

The content decides; the extension and the declared type are checked but not believed. Each allowed kind has
a structural signature at a fixed offset. For OOXML that means the zip's central directory: it must contain
`[Content_Types].xml` and exactly one of `word/document.xml` or `xl/workbook.xml`, with a local header at byte
0, so a self-extracting executable fails. The extension must name the detected kind. A declared type that
names a *different* type is a mismatch, while an absent or `octet-stream` one is not. The stored
`content_type` is the detected one. The details are in `apps/api/src/documents/file-type.ts`.

- **Allowed:** PDF, DOCX, XLSX, and JPEG, PNG, WebP, HEIC and TIFF images.
- **Refused:**
  - macro-enabled OOXML (a `vbaProject.bin` part), whatever its extension;
  - legacy `.doc`/`.xls` — OLE compound files, the same container as `.msi`, which needs a directory parser
    to tell apart and is the container most macro malware uses;
  - SVG, because it is script-capable XML;
  - anything else, because this is an allowlist.

Files are limited to 50 MB, enforced by multer while the request streams in. Uploads are held in memory,
since every check needs the whole file.

File names are cleaned of path segments, control characters and bidirectional overrides. On an RTL platform,
U+202E is how `fdp.exe` displays as `exe.pdf`.

## Downloads

There is one route to a document's bytes: `GET /documents/:id/versions/:n/download`, under
`documents.download`. In order, it:

1. opens storage, so a missing file fails with no audit entry;
2. writes `documents.downloaded` with the version's checksum;
3. commits;
4. streams.

The entry therefore precedes the bytes. A transfer that fails partway still has an entry. For this event,
a missing entry is the dangerous failure and a surplus one is not.

The stream is re-hashed as it goes, and the last chunk is held back until the hash matches. A file altered at
rest is cut off short of its `Content-Length` rather than delivered complete. The interface downloads through
`fetch` and saves only a complete body, so a tampered file is never offered.

Responses are always `attachment`, with `nosniff`, `no-store` and a sandboxing CSP, so nothing is rendered
on the application's origin.

## Permissions

| Permission | Allows |
|---|---|
| `documents.view` | The list, including file names, sizes and uploaders |
| `documents.upload` | New documents and new versions |
| `documents.download` | The bytes |
| `documents.manage` | Archiving |

View without download is the point of the split (0004). The interface hides the download control rather than
disabling it, and says once, above the list, why it is missing.

## Deferred

- **Record-level scope.** Firm-wide for now: anyone with `documents.view` sees every case's documents. When
  this arrives it belongs in the repository's `where` clause, not in a filter over results. It is the same
  open question as in 0004.
- **Malware scanning** — Phase 4. The seam is `DocumentScanner` (`scanning/document-scanner.ts`), called after
  the type check and before storage. The only implementation returns `not_scanned`, and every upload's audit
  entry records that status, so the rescan backlog is a query. An asynchronous scanner would need a
  pending state on `document_versions` and a gate on download; neither exists yet, by design.
- **Legacy `.doc`/`.xls`**, with Phase 4. Accepting them needs a compound-file parser that can tell a document
  from an installer and detect macro storage.
- **Orphaned bytes.** A failure between `put` and commit leaves a file with no row. The service checks
  everything it can before writing; the remainder needs a sweep that compares storage with `document_versions`.
- **Per-tenant encryption at rest** (threat model, hosting-provider insider). The storage interface takes
  `firmId` so an implementation can key by it.
- **Un-archiving, editing a document's title, and document entries in the dashboard activity feed.** The feed
  gates by resource type, so `document` entries are excluded until a template and a permission gate are added
  there.
