import { sql } from "drizzle-orm";
import {
  check,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { firms } from "./firms.js";

/**
 * What kind of thing a client is. Mirrored by hand from migration 0011, like
 * CASE_STATUSES — the database is the authority.
 */
export const CLIENT_TYPES = ["individual", "company"] as const;

export type ClientType = (typeof CLIENT_TYPES)[number];

/**
 * A client of one firm — a person or a company.
 *
 * The type decides which identifier the row carries, and the database enforces
 * it: an individual has a national ID and no commercial registration, a company
 * the reverse, and neither may have both. That is a CHECK rather than a
 * validation rule because the identifier is what conflict checks run against
 * and what the partial unique indexes deduplicate on — a client carrying the
 * wrong one does not fail loudly, it silently fails to deduplicate.
 *
 * Archived, never deleted. A former client's matters stay readable, and the
 * client record is what makes them legible years later — removing it would
 * leave a case attached to an identifier nobody can resolve.
 *
 * Clients are not shared between firms even when they are the same person or
 * company in the world. Two firms acting for the same client hold two records,
 * because a shared one would be a cross-tenant object by construction: every
 * edit, every note, and the mere fact of the relationship would be visible
 * across the boundary.
 */
export const clients = pgTable(
  "clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    /**
     * Arabic name — the required one, and the one every screen shows. See
     * migration 0011: requiring a Latin name the client may not have does not
     * produce an empty field, it produces an invented transliteration that
     * nobody searches for and nobody corrects.
     */
    nameAr: text("name_ar").notNull(),
    /** Latin-script name. Optional: a foreign corporate client may have none. */
    name: text("name"),
    clientType: text("client_type").$type<ClientType>().notNull(),
    /** Saudi national ID or iqama. Required for an individual, null otherwise. */
    nationalId: text("national_id"),
    /** Commercial registration. Required for a company, null otherwise. */
    commercialRegistration: text("commercial_registration"),
    /**
     * Saudi VAT registration number. Optional even for a company — registration
     * is mandatory only above a turnover threshold — and null for individuals.
     */
    vatNumber: text("vat_number"),
    phone: text("phone"),
    email: text("email"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Set to archive. The client's cases remain intact and readable. */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    // The anchor for every composite reference to a client — currently cases,
    // later documents, invoices and contracts.
    unique("clients_firm_id_id_key").on(t.firmId, t.id),

    // One client record per national ID, per firm. Two records for one person
    // splits their matters across both, so the client page shows half the
    // history and a conflict check against one comes back clean when it should
    // not. Partial because the rows without an ID can never match — NULL is
    // never equal to NULL, so they would be indexed and never used.
    uniqueIndex("clients_firm_id_national_id_key")
      .on(t.firmId, t.nationalId)
      .where(sql`${t.nationalId} is not null`),

    // Same treatment for the company identifier.
    uniqueIndex("clients_firm_id_commercial_registration_key")
      .on(t.firmId, t.commercialRegistration)
      .where(sql`${t.commercialRegistration} is not null`),

    // Constrains nothing new — (firm_id, id) is already unique. It exists to be
    // referenced: client_representatives points at this triple, which is what
    // makes a representative of an individual unrepresentable. See 0011.
    unique("clients_firm_id_id_client_type_key").on(
      t.firmId,
      t.id,
      t.clientType,
    ),

    check(
      "clients_client_type_check",
      sql`${t.clientType} in ('individual', 'company')`,
    ),

    // An exclusive either/or, so the row that carries both identifiers — the one
    // that would deduplicate against two indexes and look complete on screen —
    // is rejected along with the row that carries neither.
    check(
      "clients_identifier_by_type_check",
      sql`(${t.clientType} = 'individual' and ${t.nationalId} is not null and ${t.commercialRegistration} is null)
       or (${t.clientType} = 'company' and ${t.commercialRegistration} is not null and ${t.nationalId} is null)`,
    ),

    check(
      "clients_vat_number_company_only_check",
      sql`${t.clientType} = 'company' or ${t.vatNumber} is null`,
    ),

    // Formats. Beyond catching a transposed digit, these are what make the
    // partial unique indexes above mean something: anchored and digits-only, so
    // a given number has exactly one storable spelling and the same client
    // cannot be entered twice under two of them. A CHECK evaluating to NULL
    // passes, so each permits an absent value — presence is the separate rule
    // above.
    check(
      "clients_national_id_format_check",
      sql`${t.nationalId} ~ '^[12][0-9]{9}$'`,
    ),
    check(
      "clients_commercial_registration_format_check",
      sql`${t.commercialRegistration} ~ '^[0-9]{10}$'`,
    ),
    check(
      "clients_vat_number_format_check",
      sql`${t.vatNumber} ~ '^3[0-9]{13}3$'`,
    ),
  ],
);

export type Client = typeof clients.$inferSelect;
export type NewClient = typeof clients.$inferInsert;
