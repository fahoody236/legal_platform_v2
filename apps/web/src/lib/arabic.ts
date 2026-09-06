/**
 * Folds the Arabic spellings that a person typing a name will not distinguish.
 *
 * The same name is routinely written several ways, and none of them is wrong:
 *
 *   * Tashkeel — the short-vowel marks — is usually omitted and sometimes not.
 *     "مُحمَّد" and "محمد" are the same name and different byte strings.
 *   * Alef carries a hamza or a madda depending on the writer: أ إ آ ا.
 *     "احمد" and "أحمد" are the same person.
 *   * Taa marbuta at the end of a word is often typed as haa: "شركة" / "شركه".
 *   * Alef maqsura and yaa: "مصطفى" / "مصطفي".
 *   * Tatweel — the kashida — is decorative and carries no meaning.
 *
 * A substring match without this finds nothing for a searcher who spells a name
 * differently from whoever entered it, which for Arabic is most of the time.
 *
 * **This is a stopgap, and it belongs in the database.** CLAUDE.md says so:
 * normalisation has to be decided before the index is built, because the index
 * and the query must agree about what counts as the same string. Folding here
 * only works while the whole candidate set is already in the browser. When the
 * clients API gains a search parameter, the equivalent normalisation moves to
 * the server — applied identically to the stored value and the query — and this
 * file goes away rather than being kept in step with it.
 */
export function normaliseArabic(value: string): string {
  return (
    value
      .normalize("NFKC")
      // Tashkeel and the superscript alef.
      .replace(/[ً-ٰٟ]/g, "")
      // Tatweel.
      .replace(/ـ/g, "")
      // Alef variants → bare alef.
      .replace(/[آأإٱ]/g, "ا")
      // Taa marbuta → haa.
      .replace(/ة/g, "ه")
      // Alef maqsura → yaa.
      .replace(/ى/g, "ي")
      // Arabic-Indic digits → Latin, so a number typed either way matches.
      .replace(/[٠-٩]/g, (digit) =>
        String(digit.charCodeAt(0) - 0x0660),
      )
      .replace(/[۰-۹]/g, (digit) =>
        String(digit.charCodeAt(0) - 0x06f0),
      )
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim()
  );
}
