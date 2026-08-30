/**
 * Host header parsing, kept free of I/O and configuration so it can be reasoned
 * about — and tested — on its own.
 */

/**
 * Extracts the firm label from a Host header.
 *
 * Returns null when the host is not a subdomain of `baseDomain`, including when
 * it *is* the base domain. A request to the apex is not a request for a tenant.
 *
 * The comparison is anchored on the base domain rather than counting labels.
 * Splitting on dots and taking the first part would accept
 * `alhumoudi.platform.sa.evil.test` — an attacker-controlled hostname that
 * happens to start with a real firm's label. Requiring the host to *end* with
 * `.platform.sa` closes that.
 */
export function extractSubdomain(
  host: string | undefined,
  baseDomain: string,
): string | null {
  if (!host) return null;

  // Strip the port, and any IPv6 brackets it came wrapped in.
  const hostname = host.trim().toLowerCase().replace(/:\d+$/, "");

  const suffix = `.${baseDomain.toLowerCase()}`;

  if (!hostname.endsWith(suffix)) return null;

  const label = hostname.slice(0, -suffix.length);

  // One label only. `a.b.platform.sa` is not a firm — it is either a mistake or
  // someone probing, and guessing which is not this function's job.
  if (label === "" || label.includes(".")) return null;

  return label;
}
