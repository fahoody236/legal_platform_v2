import { z } from "zod";

const uuid = z.string().uuid();

export const documentIdSchema = uuid;

/** Version numbers start at 1. The ceiling only keeps the cast to int sane. */
export const versionNumberSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(1_000_000);

export const listDocumentsQuerySchema = z.object({
  caseId: uuid.optional(),
  includeArchived: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ListDocumentsQuery = z.infer<typeof listDocumentsQuerySchema>;

/**
 * The text fields of a new document, sent as multipart fields beside the file.
 *
 * Strict, so a `firmId` or `createdByUserId` in the form is a 400 rather than
 * a field quietly ignored. `titleAr` is required: an Arabic-first platform
 * lists documents by their Arabic title, and the interface pre-fills it from
 * the file name so requiring it costs nothing.
 *
 * Multipart fields are always strings, so an empty optional field arrives as
 * `""` and is read as absent.
 */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : null));

export const createDocumentSchema = z
  .object({
    caseId: uuid,
    titleAr: z.string().trim().min(1).max(300),
    title: optionalText(300),
    description: optionalText(2000),
  })
  .strict();

export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;

/**
 * A new version carries nothing but the file. The document's title is the
 * document's, and a version that could retitle it would make "upload a
 * corrected draft" and "rename the document" one undifferentiated act.
 */
export const addVersionSchema = z.object({}).strict();
