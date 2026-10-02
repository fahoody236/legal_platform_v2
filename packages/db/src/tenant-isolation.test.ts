import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type Database } from "./client.js";
import {
  cases,
  clients,
  documentVersions,
  documents,
  firms,
  invitations,
  users,
} from "./schema/index.js";
import { withTenant } from "./tenant-context.js";

/**
 * Cross-tenant isolation is tested for, never inferred from reading the schema
 * (docs/threat-model.md). Every claim made by migrations 0001–0004 — fail-closed
 * without a tenant context, no writes across the boundary, no deletes at all —
 * is asserted here against a real PostgreSQL server.
 *
 * The fixtures additionally have to satisfy whatever later migrations require of
 * a firm or a user, which is why they carry a subdomain (0006). Nothing below
 * tests subdomains; they are the price of inserting a valid firm.
 *
 * Two connections, because the point is the difference between them:
 *
 *   DATABASE_URL      privileged. Seeds and cleans up. Must bypass RLS, since
 *                     the schema forbids deleting users even to the table owner
 *                     — FORCE ROW LEVEL SECURITY plus no DELETE policy — so
 *                     tearing down fixtures needs a superuser.
 *   DATABASE_APP_URL  the legal_app role from migration 0003. Everything under
 *                     test runs through this one.
 *
 * See the run instructions at the foot of this file.
 */

const privilegedUrl = process.env["DATABASE_URL"];
const appUrl = process.env["DATABASE_APP_URL"];

if (!privilegedUrl || !appUrl) {
  // Deliberately not `describe.skip`. An isolation suite that quietly skips is
  // worse than none: the pipeline stays green and nobody notices it stopped
  // proving anything.
  throw new Error(
    "Tenant isolation tests need DATABASE_URL (privileged) and DATABASE_APP_URL " +
      "(the legal_app role). Both must point at a database with all migrations applied.",
  );
}

/**
 * Migration 0006 made `subdomain` required, unique across the platform, and
 * subject to a format check — 3–63 characters of lowercase letters, digits and
 * hyphens, not starting or ending with one, and not a reserved label.
 *
 * Deriving it from the firm's own uuid satisfies all of that and keeps the
 * fixtures independent of each other and of any previous run: a literal
 * "firm-a" would collide with itself the moment a run left rows behind or two
 * suites ran against the same database. Same shape as the backfill in 0006.
 */
const subdomainFor = (firmId: string) => `test-${firmId.replaceAll("-", "")}`;

const firmAId = randomUUID();
const firmBId = randomUUID();

const firmA = {
  id: firmAId,
  name: "Firm A",
  nameAr: "مكتب أ",
  subdomain: subdomainFor(firmAId),
};
const firmB = {
  id: firmBId,
  name: "Firm B",
  nameAr: "مكتب ب",
  subdomain: subdomainFor(firmBId),
};

const userA = {
  id: randomUUID(),
  firmId: firmA.id,
  email: `a-${firmA.id}@example.test`,
  fullName: "Ahmed Al-Faisal",
  fullNameAr: "أحمد الفيصل",
};
const userB = {
  id: randomUUID(),
  firmId: firmB.id,
  email: `b-${firmB.id}@example.test`,
  fullName: "Layla Al-Harbi",
  fullNameAr: "ليلى الحربي",
};

/**
 * A client and a case per firm, for the document tests. The commercial
 * registration satisfies 0011's identifier check for a company. A literal is
 * safe here where it was not for subdomains: registrations are unique per
 * firm, and every run's firms are new.
 */
const clientA = {
  id: randomUUID(),
  firmId: firmA.id,
  clientType: "company" as const,
  nameAr: "شركة أ",
  commercialRegistration: "1010000001",
};
const clientB = {
  id: randomUUID(),
  firmId: firmB.id,
  clientType: "company" as const,
  nameAr: "شركة ب",
  commercialRegistration: "1010000002",
};
const caseA = {
  id: randomUUID(),
  firmId: firmA.id,
  clientId: clientA.id,
  caseNumber: `T-${firmA.id.slice(0, 8)}`,
  titleAr: "قضية أ",
  caseType: "civil",
  status: "open" as const,
};
const caseB = {
  id: randomUUID(),
  firmId: firmB.id,
  clientId: clientB.id,
  caseNumber: `T-${firmB.id.slice(0, 8)}`,
  titleAr: "قضية ب",
  caseType: "civil",
  status: "open" as const,
};

let privileged: ReturnType<typeof createClient>;
let app: ReturnType<typeof createClient>;
let appDb: Database;

beforeAll(async () => {
  privileged = createClient(privilegedUrl);
  app = createClient(appUrl);
  appDb = app.db;

  await privileged.db.insert(firms).values([firmA, firmB]);
  await privileged.db.insert(users).values([userA, userB]);
  await privileged.db.insert(clients).values([clientA, clientB]);
  await privileged.db.insert(cases).values([caseA, caseB]);
});

afterAll(async () => {
  // Ordered by the foreign keys: versions reference documents, documents
  // cases and users, cases clients, invitations users, users firms.
  const fixtureFirms = [firmA.id, firmB.id];
  await privileged.db
    .delete(documentVersions)
    .where(inArray(documentVersions.firmId, fixtureFirms));
  await privileged.db
    .delete(documents)
    .where(inArray(documents.firmId, fixtureFirms));
  await privileged.db.delete(cases).where(inArray(cases.firmId, fixtureFirms));
  await privileged.db
    .delete(clients)
    .where(inArray(clients.firmId, fixtureFirms));
  await privileged.db
    .delete(invitations)
    .where(inArray(invitations.firmId, [firmA.id, firmB.id]));
  await privileged.db
    .delete(users)
    .where(inArray(users.firmId, [firmA.id, firmB.id]));
  await privileged.db
    .delete(firms)
    .where(inArray(firms.id, [firmA.id, firmB.id]));

  await Promise.all([privileged.pool.end(), app.pool.end()]);
});

/**
 * Reads the fixture rows through the privileged connection, which is not
 * subject to the policies. That is the point: to show a rejected write changed
 * nothing, the check has to see what the application role cannot.
 */
async function fixtureUsers() {
  return privileged.db
    .select()
    .from(users)
    .where(inArray(users.firmId, [firmA.id, firmB.id]));
}

describe("tenant isolation", () => {
  /**
   * Guards every assertion below. PostgreSQL ignores row-level security for
   * superusers and for roles holding BYPASSRLS — the policies remain in the
   * catalog and are simply not consulted. Pointed at such a role, the reads
   * below would return both firms and fail, but with a confusing message about
   * row counts rather than the real cause.
   */
  it("runs as a role that does not bypass row-level security", async () => {
    const result = await appDb.execute<{
      rolname: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(
      sql`select rolname, rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
    );

    const role = result.rows[0];
    expect(role, "could not resolve the current database role").toBeDefined();
    expect(role?.rolsuper, `${role?.rolname} is a superuser`).toBe(false);
    expect(role?.rolbypassrls, `${role?.rolname} has BYPASSRLS`).toBe(false);
  });

  it("returns only firm A's users inside withTenant(firmA)", async () => {
    const rows = await withTenant(appDb, firmA.id, async (tx) =>
      tx.select().from(users),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(userA.id);
    expect(rows[0]?.firmId).toBe(firmA.id);
  });

  it("returns only firm B's users inside withTenant(firmB)", async () => {
    const rows = await withTenant(appDb, firmB.id, async (tx) =>
      tx.select().from(users),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(userB.id);
    expect(rows[0]?.firmId).toBe(firmB.id);
  });

  /**
   * The one that matters most. A missing tenant context must read as an empty
   * database, not an unscoped one — the failure mode of a forgotten
   * `withTenant` is zero rows, never every firm's rows.
   */
  it("returns zero rows with no tenant context, not every row", async () => {
    const rows = await appDb.select().from(users);
    expect(rows).toHaveLength(0);
  });

  it("refuses an insert carrying another firm's firm_id", async () => {
    const attempt = withTenant(appDb, firmA.id, async (tx) =>
      tx.insert(users).values({
        firmId: firmB.id,
        email: `smuggled-${randomUUID()}@example.test`,
        fullName: "Should Not Exist",
      }),
    );

    // Only that it rejects. Drizzle wraps the driver error, so the Postgres
    // text is not on the message — and asserting on wording would be testing
    // the ORM's error formatting rather than the security property. What the
    // write did to the data is the property that matters.
    await expect(attempt).rejects.toThrow();

    const rows = await fixtureUsers();
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.firmId === firmB.id)).toHaveLength(1);
  });

  it("refuses moving one of its own users into another firm", async () => {
    const attempt = withTenant(appDb, firmA.id, async (tx) =>
      tx.update(users).set({ firmId: firmB.id }).where(eq(users.id, userA.id)),
    );

    await expect(attempt).rejects.toThrow();

    // Checked through the privileged connection: if the row had moved to firm
    // B, a read scoped to firm A would report it missing rather than moved, and
    // the test would pass for the wrong reason.
    const [row] = await privileged.db
      .select()
      .from(users)
      .where(eq(users.id, userA.id));
    expect(row?.firmId).toBe(firmA.id);
  });

  /**
   * Refused twice over: migration 0003 grants no DELETE privilege, and 0001
   * defines no DELETE policy, so RLS would deny it even if the grant existed.
   * Nothing in this product deletes a legal record.
   */
  it("refuses to delete a user at all", async () => {
    const attempt = withTenant(appDb, firmA.id, async (tx) =>
      tx.delete(users).where(eq(users.id, userA.id)),
    );

    await expect(attempt).rejects.toThrow();

    const rows = await withTenant(appDb, firmA.id, async (tx) =>
      tx.select().from(users),
    );
    expect(rows).toHaveLength(1);
  });

  /**
   * An invitation token is the power to set a person's password, and the
   * acceptance route is public — so this is the one table where a cross-tenant
   * read would hand over an account rather than a record. Firm A's invitation,
   * looked up by its hash under firm B's context, must not exist.
   */
  it("keeps one firm's invitation invisible under another firm's context", async () => {
    const tokenHash = `test-${randomUUID()}`;

    await withTenant(appDb, firmA.id, async (tx) =>
      tx.insert(invitations).values({
        firmId: firmA.id,
        userId: userA.id,
        invitedByUserId: userA.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 60_000),
      }),
    );

    const fromB = await withTenant(appDb, firmB.id, async (tx) =>
      tx.select().from(invitations).where(eq(invitations.tokenHash, tokenHash)),
    );
    expect(fromB).toHaveLength(0);

    const withoutContext = await appDb
      .select()
      .from(invitations)
      .where(eq(invitations.tokenHash, tokenHash));
    expect(withoutContext).toHaveLength(0);

    const fromA = await withTenant(appDb, firmA.id, async (tx) =>
      tx.select().from(invitations).where(eq(invitations.tokenHash, tokenHash)),
    );
    expect(fromA).toHaveLength(1);

    const deletion = withTenant(appDb, firmA.id, async (tx) =>
      tx.delete(invitations).where(eq(invitations.tokenHash, tokenHash)),
    );
    await expect(deletion).rejects.toThrow();
  });
});

/**
 * Documents (0018). The table whose contents are the most sensitive thing on
 * the platform, so each claim the migration makes is checked here rather than
 * read off it: invisible across firms, unattachable across firms, never
 * deleted, and — for versions — never edited.
 */
describe("tenant isolation: documents", () => {
  const checksum = `sha256:${"0".repeat(64)}`;

  async function createDocumentInA() {
    return withTenant(appDb, firmA.id, async (tx) => {
      const [document] = await tx
        .insert(documents)
        .values({
          firmId: firmA.id,
          caseId: caseA.id,
          titleAr: "لائحة الدعوى",
          createdByUserId: userA.id,
        })
        .returning();

      if (!document) throw new Error("fixture document not created");

      const [version] = await tx
        .insert(documentVersions)
        .values({
          firmId: firmA.id,
          documentId: document.id,
          versionNumber: 1,
          fileName: "لائحة.pdf",
          contentType: "application/pdf",
          sizeBytes: 1024,
          storageKey: `${firmA.id}/${randomUUID()}`,
          checksum,
          uploadedByUserId: userA.id,
        })
        .returning();

      if (!version) throw new Error("fixture version not created");

      return { document, version };
    });
  }

  it("keeps firm A's documents and versions invisible to firm B and to no context", async () => {
    const { document, version } = await createDocumentInA();

    const fromB = await withTenant(appDb, firmB.id, async (tx) => ({
      documents: await tx
        .select()
        .from(documents)
        .where(eq(documents.id, document.id)),
      versions: await tx
        .select()
        .from(documentVersions)
        .where(eq(documentVersions.id, version.id)),
    }));
    expect(fromB.documents).toHaveLength(0);
    expect(fromB.versions).toHaveLength(0);

    // The storage key is what addresses the bytes. Its row being invisible is
    // what keeps another firm from ever holding it.
    const withoutContext = await appDb
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.id, version.id));
    expect(withoutContext).toHaveLength(0);

    const fromA = await withTenant(appDb, firmA.id, async (tx) =>
      tx.select().from(documentVersions).where(eq(documentVersions.id, version.id)),
    );
    expect(fromA).toHaveLength(1);
  });

  it("refuses a document in firm A that points at firm B's case", async () => {
    const attempt = withTenant(appDb, firmA.id, async (tx) =>
      tx.insert(documents).values({
        firmId: firmA.id,
        caseId: caseB.id,
        titleAr: "تسريب",
        createdByUserId: userA.id,
      }),
    );

    await expect(attempt).rejects.toThrow();
  });

  it("refuses firm B attaching a version to firm A's document", async () => {
    const { document } = await createDocumentInA();

    const attempt = withTenant(appDb, firmB.id, async (tx) =>
      tx.insert(documentVersions).values({
        firmId: firmB.id,
        documentId: document.id,
        versionNumber: 2,
        fileName: "مدسوس.pdf",
        contentType: "application/pdf",
        sizeBytes: 1,
        storageKey: `${firmB.id}/${randomUUID()}`,
        checksum,
        uploadedByUserId: userB.id,
      }),
    );

    await expect(attempt).rejects.toThrow();

    const versions = await privileged.db
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.documentId, document.id));
    expect(versions).toHaveLength(1);
  });

  it("refuses moving a document into another firm", async () => {
    const { document } = await createDocumentInA();

    const attempt = withTenant(appDb, firmA.id, async (tx) =>
      tx
        .update(documents)
        .set({ firmId: firmB.id })
        .where(eq(documents.id, document.id)),
    );

    await expect(attempt).rejects.toThrow();

    const [row] = await privileged.db
      .select()
      .from(documents)
      .where(eq(documents.id, document.id));
    expect(row?.firmId).toBe(firmA.id);
  });

  /**
   * A version is the record of what was uploaded. Editing its checksum or its
   * storage key would make the trail describe a file that is not the one
   * served, so the application role holds no UPDATE on the table at all.
   */
  it("refuses editing a version, even within the firm", async () => {
    const { version } = await createDocumentInA();

    const attempt = withTenant(appDb, firmA.id, async (tx) =>
      tx
        .update(documentVersions)
        .set({ storageKey: `${firmA.id}/${randomUUID()}` })
        .where(eq(documentVersions.id, version.id)),
    );

    await expect(attempt).rejects.toThrow();

    const [row] = await privileged.db
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.id, version.id));
    expect(row?.storageKey).toBe(version.storageKey);
  });

  it("refuses deleting a document or a version", async () => {
    const { document, version } = await createDocumentInA();

    await expect(
      withTenant(appDb, firmA.id, async (tx) =>
        tx.delete(documentVersions).where(eq(documentVersions.id, version.id)),
      ),
    ).rejects.toThrow();

    await expect(
      withTenant(appDb, firmA.id, async (tx) =>
        tx.delete(documents).where(eq(documents.id, document.id)),
      ),
    ).rejects.toThrow();

    const remaining = await privileged.db
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.id, version.id));
    expect(remaining).toHaveLength(1);
  });
});

/**
 * Running it
 * ──────────
 *   docker compose up -d
 *   pnpm --filter @legal/db run migrate
 *   psql "$DATABASE_URL" -c "ALTER ROLE legal_app PASSWORD '$LEGAL_APP_PASSWORD'"
 *   pnpm --filter @legal/db run test
 *
 * with, in .env:
 *   DATABASE_URL=postgresql://postgres:devpass@localhost:5433/legal_platform
 *   DATABASE_APP_URL=postgresql://legal_app:<password>@localhost:5433/legal_platform
 *
 * Vitest does not read .env by itself, so export it into the shell first:
 *   set -a; . ./.env; set +a
 */
