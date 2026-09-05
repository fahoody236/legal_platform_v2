import {
  addRepresentative,
  assignRoleToUser,
  createCase,
  createClientRecord,
  createClient as createDatabaseClient,
  createRole,
  findClientById,
  findRoleByName,
  grantPermissionsToRole,
  listCases,
  listClients,
  listPermissions,
  listUsers,
  resolveFirmBySubdomain,
  withTenant,
  type Case,
  type CaseStatus,
  type Client,
  type TenantTransaction,
} from "@legal/db";

/**
 * ⚠️  DEVELOPMENT ONLY. Never run this against a database holding real client
 * data.
 *
 * It invents Saudi national IDs, commercial registrations, VAT numbers, people
 * and matters. Those are not placeholder-looking strings — they are formatted to
 * pass the same CHECK constraints a real identifier does, because the point of a
 * fixture is to exercise the real path. On a production database the result
 * would be fabricated clients and fabricated matters sitting in a firm's own
 * list, indistinguishable from records a person entered, in tables from which
 * nothing can be deleted.
 *
 * The guard below refuses to run when NODE_ENV is "production", following
 * tenant.config.ts. That guard is a safety net, not permission: a database
 * reached with NODE_ENV unset is just as real.
 *
 * Usage:
 *   pnpm --filter @legal/api run seed-dev <subdomain>
 *
 * The firm and at least one user must already exist. This script does not
 * create either: a firm is an onboarding decision and a user needs a password,
 * which is `set-password`'s job.
 *
 * ── How it works ─────────────────────────────────────────────────────────────
 *
 * Everything goes through the repository functions inside one `withTenant`
 * transaction — no raw SQL — so the seed travels the same route a request does
 * and is subject to the same row-level security. A fixture that reached the
 * tables by a privileged side door would be a fixture that proves nothing about
 * whether the application can create this data.
 *
 * One transaction for the whole seed, so a failure half way through leaves
 * nothing behind to reconcile.
 *
 * ── Idempotency ──────────────────────────────────────────────────────────────
 *
 * Running it twice creates nothing twice. Each record is looked up by the value
 * that identifies it — the role by name, clients by national ID or commercial
 * registration, cases by case number, representatives by name — and skipped if
 * present. Grants use ON CONFLICT DO NOTHING.
 *
 * Note what this deliberately does *not* do: it never updates an existing row.
 * If someone has edited a seeded client, that edit survives. A seed that
 * reset records to their fixture values would quietly destroy whatever the
 * developer was in the middle of testing.
 *
 * ── No audit entries ─────────────────────────────────────────────────────────
 *
 * The seed writes through repositories rather than services, so it records
 * nothing in the audit log. That is the right choice rather than an omission:
 * an audit entry asserts that a named person did something at a time, and
 * nobody did this. Writing fabricated actions into the one table that cannot be
 * edited or deleted is a poor habit to build in development, where it is
 * harmless, and to carry anywhere else.
 */

const ROLE_NAME = "مدير المكتب";

interface ClientFixture {
  key: string;
  create: Parameters<typeof createClientRecord>[1];
  representatives?: Parameters<typeof addRepresentative>[2][];
}

/**
 * Identifiers are the idempotency key: `national_id` for an individual,
 * `commercial_registration` for a company. Both carry a partial unique index
 * per firm, so they are the values the database itself treats as identifying —
 * matching on anything else would let a second run create a duplicate that the
 * index then refuses, which is a crash rather than a no-op.
 */
const CLIENT_FIXTURES: ClientFixture[] = [
  {
    key: "1052341987",
    create: {
      clientType: "individual",
      nameAr: "محمد بن عبدالله القحطاني",
      name: "Mohammed Abdullah Al-Qahtani",
      nationalId: "1052341987",
      phone: "+966501234567",
      email: "m.alqahtani@example.sa",
      notes: "عميل بموجب اتفاقية أتعاب سنوية.",
    },
  },
  {
    key: "2043128765",
    create: {
      clientType: "individual",
      nameAr: "نورة بنت سعد العتيبي",
      nationalId: "2043128765",
      phone: "+966555987321",
      notes: "التواصل عبر الهاتف فقط بناءً على طلب العميلة.",
    },
  },
  {
    key: "1010234567",
    create: {
      clientType: "company",
      nameAr: "شركة الواحة للمقاولات المحدودة",
      name: "Al-Waha Contracting Company Ltd",
      commercialRegistration: "1010234567",
      vatNumber: "300123456700003",
      phone: "+966112345678",
      email: "legal@alwaha.example.sa",
    },
    representatives: [
      {
        nameAr: "خالد بن فهد الدوسري",
        name: "Khalid Fahd Al-Dosari",
        nationalId: "1076543210",
        role: "المدير العام",
      },
      {
        nameAr: "سارة بنت ناصر الشمري",
        nationalId: "2011223344",
        role: "مفوضة بالتوقيع",
      },
    ],
  },
];

interface CaseFixture {
  caseNumber: string;
  clientKey: string;
  titleAr: string;
  title?: string;
  caseType: string;
  court?: string;
  status: CaseStatus;
  assignToLawyer: boolean;
  closed?: boolean;
}

const CASE_FIXTURES: CaseFixture[] = [
  {
    caseNumber: "2026/001",
    clientKey: "1010234567",
    titleAr: "مطالبة مالية بقيمة عقد توريد مواد بناء",
    title: "Supply contract payment claim",
    caseType: "تجاري",
    court: "المحكمة التجارية بالرياض",
    status: "in_progress",
    assignToLawyer: true,
  },
  {
    caseNumber: "2026/002",
    clientKey: "1052341987",
    titleAr: "دعوى عمالية للمطالبة بمستحقات نهاية الخدمة",
    caseType: "عمالي",
    court: "المحكمة العمالية بالرياض",
    status: "open",
    assignToLawyer: true,
  },
  {
    caseNumber: "2026/003",
    clientKey: "2043128765",
    titleAr: "نزاع على ملكية عقار بحي النرجس",
    caseType: "عقاري",
    court: "المحكمة العامة بالرياض",
    status: "pending",
    assignToLawyer: false,
  },
  {
    caseNumber: "2026/004",
    clientKey: "1010234567",
    titleAr: "اعتراض على قرار لجنة الفصل في مخالفات نظام العمل",
    caseType: "إداري",
    court: "المحكمة الإدارية بالرياض",
    status: "closed",
    assignToLawyer: true,
    closed: true,
  },
  {
    caseNumber: "2026/005",
    clientKey: "1052341987",
    titleAr: "مراجعة وصياغة عقد شراكة تجارية",
    caseType: "استشاري",
    // No court: advisory work has no forum, which is why the column is nullable.
    status: "open",
    assignToLawyer: false,
  },
];

function identifierOf(client: Client): string | null {
  return client.nationalId ?? client.commercialRegistration;
}

async function seedRole(
  tx: TenantTransaction,
  firstUserId: string,
): Promise<{ created: boolean; permissionCount: number }> {
  const existing = await findRoleByName(tx, ROLE_NAME);
  const role = existing ?? (await createRole(tx, { name: ROLE_NAME }));

  // Every key in the catalogue, read from the catalogue rather than listed
  // here. A migration that adds a permission then reaches this role on the next
  // run, instead of leaving a hardcoded list quietly one behind.
  const catalogue = await listPermissions(tx);

  await grantPermissionsToRole(
    tx,
    role.id,
    catalogue.map((permission) => permission.key),
  );
  await assignRoleToUser(tx, firstUserId, role.id);

  return { created: existing === undefined, permissionCount: catalogue.length };
}

async function seedClients(
  tx: TenantTransaction,
): Promise<{ byKey: Map<string, Client>; created: number }> {
  const { items } = await listClients(tx, { limit: 200, offset: 0 });
  const byKey = new Map<string, Client>();

  for (const client of items) {
    const identifier = identifierOf(client);

    if (identifier) {
      byKey.set(identifier, client);
    }
  }

  let created = 0;

  for (const fixture of CLIENT_FIXTURES) {
    let client = byKey.get(fixture.key);

    if (!client) {
      client = await createClientRecord(tx, fixture.create);
      byKey.set(fixture.key, client);
      created += 1;
    }

    if (!fixture.representatives) {
      continue;
    }

    // Read back through findClientById, which is the function that returns a
    // client with its representatives — the same one the API uses for the
    // client page.
    const withRepresentatives = await findClientById(tx, client.id);
    const present = new Set(
      withRepresentatives?.representatives.map(
        (representative) => representative.nameAr,
      ),
    );

    for (const representative of fixture.representatives) {
      if (!present.has(representative.nameAr)) {
        await addRepresentative(tx, client.id, representative);
      }
    }
  }

  return { byKey, created };
}

async function seedCases(
  tx: TenantTransaction,
  clientsByKey: Map<string, Client>,
  lawyerId: string,
): Promise<number> {
  const { items } = await listCases(tx, { limit: 200, offset: 0 });
  const existing = new Set(items.map((row: Case) => row.caseNumber));

  let created = 0;

  for (const fixture of CASE_FIXTURES) {
    if (existing.has(fixture.caseNumber)) {
      continue;
    }

    const client = clientsByKey.get(fixture.clientKey);

    if (!client) {
      throw new Error(
        `Case ${fixture.caseNumber} names client ${fixture.clientKey}, which was not seeded.`,
      );
    }

    await createCase(tx, {
      clientId: client.id,
      caseNumber: fixture.caseNumber,
      titleAr: fixture.titleAr,
      title: fixture.title ?? null,
      caseType: fixture.caseType,
      court: fixture.court ?? null,
      status: fixture.status,
      assignedLawyerId: fixture.assignToLawyer ? lawyerId : null,
    });

    created += 1;
  }

  return created;
}

async function main(): Promise<void> {
  if (process.env["NODE_ENV"] === "production") {
    console.error(
      "seed-dev refuses to run with NODE_ENV=production. It writes fabricated " +
        "clients and matters into tables that grant no DELETE.",
    );
    process.exit(1);
  }

  const [subdomain] = process.argv.slice(2);

  if (!subdomain) {
    console.error("Usage: seed-dev <subdomain>");
    process.exit(1);
  }

  const url = process.env["DATABASE_URL"];

  if (!url) {
    console.error("DATABASE_URL must be set.");
    process.exit(1);
  }

  const { db, pool } = createDatabaseClient(url);

  try {
    const firmId = await resolveFirmBySubdomain(db, subdomain);

    if (!firmId) {
      console.error(`No active firm with subdomain "${subdomain}".`);
      process.exitCode = 1;
      return;
    }

    const summary = await withTenant(db, firmId, async (tx) => {
      const users = await listUsers(tx);

      // Oldest by creation, not first alphabetically: listUsers orders by name,
      // and "whoever sorts first" is not a meaningful choice of administrator.
      const firstUser = [...users].sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
      )[0];

      if (!firstUser) {
        return null;
      }

      const role = await seedRole(tx, firstUser.id);
      const clients = await seedClients(tx);
      const cases = await seedCases(tx, clients.byKey, firstUser.id);

      return { firstUser, role, clients, cases };
    });

    if (!summary) {
      console.error(
        `Firm "${subdomain}" has no users. Create one before seeding — the role ` +
          "has to be assigned to somebody.",
      );
      process.exitCode = 1;
      return;
    }

    console.log(`Seeded ${subdomain}:`);
    console.log(
      `  role      "${ROLE_NAME}" ${summary.role.created ? "created" : "already present"}, ` +
        `${summary.role.permissionCount} permission(s), assigned to ${summary.firstUser.email}`,
    );
    console.log(
      `  clients   ${summary.clients.created} created, ${CLIENT_FIXTURES.length - summary.clients.created} already present`,
    );
    console.log(
      `  cases     ${summary.cases} created, ${CASE_FIXTURES.length - summary.cases} already present`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
