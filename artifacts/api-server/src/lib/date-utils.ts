/**
 * Converts any Date objects in a record to YYYY-MM-DD strings.
 * Needed because Orval's useDates:true coerces date strings to Date objects,
 * but Drizzle date columns (mode:"string") expect string inputs.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function datesToStrings(data: Record<string, unknown>): any {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value instanceof Date) {
      result[key] = value.toISOString().split("T")[0];
    } else {
      result[key] = value;
    }
  }
  return result;
}
