import { useEffect, useState } from "react";

/**
 * The value, held back until it stops changing for `delayMs`.
 *
 * Typing "القحطاني" is eight state updates. Without this, each one is a query
 * key, a request, and a render — and the seven intermediate answers are all
 * discarded, having cost a round trip each. Worse, they can arrive out of
 * order, so the list briefly shows results for a prefix the person has already
 * finished typing.
 *
 * The timer restarts on every keystroke and is cleared on unmount, so a
 * component that goes away mid-word does not wake up to set state on nothing.
 */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
