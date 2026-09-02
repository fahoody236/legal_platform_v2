import { CLIENT_TYPES } from "@legal/db";
import { z } from "zod";

/**
 * Every input to the clients API.
 *
 * The identifier rules are expressed here in full, mirroring migration 0011.
 * The database constraint stays the second line of defence, not the first: a
 * caller who sends a company with a national ID gets a 400 that says so, rather
 * than a 500 from a CHECK violation that mentions a constraint name they cannot
 * act on. The constraint still exists because a schema protects one route,
 * while the constraint protects the table.
 *
 * The formats are the same patterns the migration carries — 10 digits beginning
 * 1 or 2 for a national ID, 10 digits for a commercial registration, 15 digits
 * beginning and ending with 3 for VAT. Duplicated deliberately, like
 * CASE_STATUSES and RESERVED_SUBDOMAINS: the database remains the authority,
 * and this copy exists so the caller learns what is wrong.
 */

const NATIONAL_ID = /^[12][0-9]{9}$/;
const COMMERCIAL_REGISTRATION = /^[0-9]{10}$/;
const VAT_NUMBER = /^3[0-9]{13}3$/;

const nationalId = z.string().trim().regex(NATIONAL_ID);
const commercialRegistration = z.string().trim().regex(COMMERCIAL_REGISTRATION);
const vatNumber = z.string().trim().regex(VAT_NUMBER);

/**
 * A field this client type may not carry. Absent or explicitly null passes;
 * anything else fails. Allowing an explicit null means a form that always sends
 * every key is not forced to know which ones to omit.
 */
const forbidden = z.null().optional();

const commonClientFields = {
  nameAr: z.string().trim().min(1).max(300),
  name: z.string().trim().min(1).max(300).nullish(),
  phone: z.string().trim().min(1).max(40).nullish(),
  email: z.string().trim().max(320).email().nullish(),
  notes: z.string().trim().min(1).max(5000).nullish(),
};

/**
 * A discriminated union rather than one object with a refinement, so the error
 * points at the field that is wrong instead of at the object as a whole — and
 * so the two shapes are readable side by side as the two things a client can be.
 */
export const createClientSchema = z.discriminatedUnion("clientType", [
  z
    .object({
      clientType: z.literal(CLIENT_TYPES[0]),
      /** Required. An individual is identified by their national ID or iqama. */
      nationalId,
      commercialRegistration: forbidden,
      /** VAT registration is a property of a business. */
      vatNumber: forbidden,
      ...commonClientFields,
    })
    .strict(),
  z
    .object({
      clientType: z.literal(CLIENT_TYPES[1]),
      nationalId: forbidden,
      /** Required. A company is identified by its commercial registration. */
      commercialRegistration,
      /**
       * Permitted, not required: registration is mandatory only above a
       * turnover threshold, so a small company legitimately has none.
       */
      vatNumber: vatNumber.nullish(),
      ...commonClientFields,
    })
    .strict(),
]);

export type CreateClientInput = z.infer<typeof createClientSchema>;

/**
 * `.strict()`, and `clientType` is not a key.
 *
 * That combination is what makes the type immutable at this layer: an attempt to
 * change it is an unknown key and comes back 400. Zod's default would strip it
 * silently, which is the worst outcome — the caller believes the client is now a
 * company, the record says otherwise, and nothing reports a disagreement.
 *
 * Identifiers are editable because a mistyped national ID must be correctable
 * and a company that registers for VAT later must be able to record it. Whether
 * the result is consistent with the stored type cannot be decided here — this
 * schema has never seen the stored row — so the service checks the merged state
 * before writing. See ClientsService.update.
 */
export const updateClientSchema = z
  .object({
    nameAr: z.string().trim().min(1).max(300).optional(),
    name: z.string().trim().min(1).max(300).nullish(),
    nationalId: nationalId.optional(),
    commercialRegistration: commercialRegistration.optional(),
    vatNumber: vatNumber.nullish(),
    phone: z.string().trim().min(1).max(40).nullish(),
    email: z.string().trim().max(320).email().nullish(),
    notes: z.string().trim().min(1).max(5000).nullish(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);

export type UpdateClientInput = z.infer<typeof updateClientSchema>;

export const listClientsQuerySchema = z.object({
  clientType: z.enum(CLIENT_TYPES).optional(),
  // Query strings arrive as text. Only these two spellings count as a boolean,
  // so `archived=maybe` is a 400 rather than a silent false.
  archived: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ListClientsQuery = z.infer<typeof listClientsQuerySchema>;

export const idSchema = z.string().uuid();

export const addRepresentativeSchema = z
  .object({
    nameAr: z.string().trim().min(1).max(300),
    name: z.string().trim().min(1).max(300).nullish(),
    /** Optional here, unlike on an individual client — see the schema file. */
    nationalId: nationalId.nullish(),
    /** Required: it is the reason this person is on the record. */
    role: z.string().trim().min(1).max(200),
  })
  .strict();

export type AddRepresentativeInput = z.infer<typeof addRepresentativeSchema>;

export const updateRepresentativeSchema = z
  .object({
    nameAr: z.string().trim().min(1).max(300).optional(),
    name: z.string().trim().min(1).max(300).nullish(),
    nationalId: nationalId.nullish(),
    role: z.string().trim().min(1).max(200).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);

export type UpdateRepresentativeInput = z.infer<
  typeof updateRepresentativeSchema
>;
