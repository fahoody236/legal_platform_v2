/**
 * Tap-target audit. Paste into the console of the page under test (Safari's
 * Web Inspector in Responsive Design Mode, or on the iPad through the Mac's
 * inspector) and it prints every interactive element smaller than 44 × 44 CSS
 * px, with its size and a way to find it.
 *
 * Nothing is installed and nothing is imported: it is one function over the
 * live document, so the number it gives is the number the page really has at
 * that width, in that state, with whatever is open.
 *
 * Usage:   tapTargets()            — table of offenders, summary line
 *          tapTargets({ min: 48 }) — a stricter bar
 */
function tapTargets({ min = 44, log = true } = {}) {
  const selector = [
    "a[href]",
    "button",
    "input:not([type=hidden])",
    "select",
    "textarea",
    "summary",
    "[role=button]",
    "[role=option]",
    "[role=tab]",
    "label.toggle",
    "label.permission-toggle",
  ].join(",");

  const seen = new Set();
  const rows = [];
  let total = 0;

  for (const element of document.querySelectorAll(selector)) {
    // A checkbox inside a label that is itself a target is measured as the
    // label: the label is what the finger lands on.
    const owner = element.closest("label.toggle, label.permission-toggle");
    const target = owner && owner !== element ? owner : element;
    if (seen.has(target)) continue;
    seen.add(target);

    const rect = target.getBoundingClientRect();
    const style = getComputedStyle(target);
    const visible =
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== "hidden" &&
      style.display !== "none";
    if (!visible) continue;

    total += 1;

    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    if (width >= min && height >= min) continue;

    rows.push({
      size: `${width}×${height}`,
      tag: target.tagName.toLowerCase(),
      class: target.className && typeof target.className === "string" ? target.className : "",
      text: (target.getAttribute("aria-label") || target.textContent || "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 40),
    });
  }

  const summary = `${rows.length} of ${total} targets under ${min}px at ${window.innerWidth}×${window.innerHeight} (touch=${document.documentElement.dataset.touch ?? "unset"})`;

  if (log) {
    console.log(summary);
    if (rows.length > 0) console.table(rows);
  }

  return { summary, offenders: rows, total };
}

// Make it reachable from the console after pasting, and from automation.
globalThis.tapTargets = tapTargets;
