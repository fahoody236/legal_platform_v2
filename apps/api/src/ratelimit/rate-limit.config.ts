import { parseRange, type TrustedProxies } from "./client-address.js";

/**
 * Evaluated when the module graph loads, so a misconfiguration is a startup
 * failure rather than a firm discovering at nine in the morning that it is
 * one address. Same shape as mail.config.ts and storage.config.ts.
 */

const isProduction = process.env["NODE_ENV"] === "production";

const raw = process.env["TRUSTED_PROXIES"];

/**
 * Development defaults to trusting nothing; production must say. `none` is a
 * real answer — a deployment where the API terminates its own connections —
 * and has to be written out, because the alternative to writing it out is a
 * deployment behind a proxy nobody told the limiter about.
 */
function resolveTrustedProxies(): TrustedProxies {
  if (raw === undefined || raw.trim() === "") {
    if (isProduction) {
      throw new Error(
        'TRUSTED_PROXIES must be set in production: a list of proxy addresses ' +
          'or CIDR ranges, or "none" if the API terminates its own ' +
          "connections. See apps/api/src/ratelimit/client-address.ts.",
      );
    }
    return { kind: "none" };
  }

  if (raw.trim().toLowerCase() === "none") {
    return { kind: "none" };
  }

  const ranges = raw.split(",").map((entry) => {
    const range = parseRange(entry);
    if (!range) {
      throw new Error(
        `TRUSTED_PROXIES entry "${entry.trim()}" is not an address or CIDR range.`,
      );
    }
    return range;
  });

  // A range wide enough to include the clients themselves would let any
  // client pick its own address. 0.0.0.0/0 and ::/0 are the obvious cases.
  for (const range of ranges) {
    if (range.bits <= 96 && range.text.includes(".")) {
      throw new Error(
        `TRUSTED_PROXIES entry "${range.text}" trusts every IPv4 address.`,
      );
    }
    if (range.bits === 0) {
      throw new Error(`TRUSTED_PROXIES entry "${range.text}" trusts everything.`);
    }
  }

  return { kind: "list", ranges };
}

export const rateLimitConfig = {
  trustedProxies: resolveTrustedProxies(),
} as const;
