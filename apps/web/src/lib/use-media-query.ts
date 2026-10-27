import { useEffect, useState } from "react";

/**
 * Whether a media query matches, kept current as the window changes.
 *
 * Used where a screen renders a different structure at a different width — a
 * table or a list of cards — rather than merely different styles. CSS could
 * hide one and show the other, but then both exist in the document, both are
 * read to assistive technology, and the list fetches nothing twice only
 * because it happens to share one query. Rendering one is simpler to reason
 * about.
 *
 * The initial value is read synchronously, so there is no first paint in the
 * wrong shape; the listener handles rotation, which crosses the breakpoint on
 * every iPad the pilot firm has.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    setMatches(list.matches);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/** The width below which the sidebar leaves the flow and tables become cards; matches index.css. */
export const NARROW = "(max-width: 60rem)";
