/**
 * Evaluated when the module graph loads, so a misconfiguration is a startup
 * failure rather than a surprise on the first request.
 */

const platformDomain = process.env["PLATFORM_DOMAIN"];

if (!platformDomain) {
  throw new Error(
    "PLATFORM_DOMAIN environment variable is required but was not provided " +
      '(for example "platform.sa"). Requests are resolved to a firm by subdomain, ' +
      "so there is no sensible default.",
  );
}

const isProduction = process.env["NODE_ENV"] === "production";

/**
 * Local development override.
 *
 * `localhost` has no subdomain, so without this every request would resolve to
 * no firm and 404. Setting DEV_FIRM_SUBDOMAIN makes hosts that carry no firm
 * label behave as though they carried this one.
 *
 * Refused outright in production rather than merely discouraged. This variable
 * pins every request to one firm regardless of the hostname, which in a
 * multi-tenant deployment is not a convenience but a cross-tenant routing bug
 * with a friendly name. Failing at startup means it cannot be set by accident
 * in an environment where it would do damage.
 *
 * It is not an authentication bypass — it decides which firm a request belongs
 * to, not who the caller is. It still resolves through the same lookup and
 * still 404s if the subdomain does not exist.
 */
const devFirmSubdomain = process.env["DEV_FIRM_SUBDOMAIN"];

if (devFirmSubdomain && isProduction) {
  throw new Error(
    "DEV_FIRM_SUBDOMAIN is set while NODE_ENV=production. It forces every " +
      "request to one firm irrespective of the Host header, which would route " +
      "one firm's users into another firm's data. Unset it.",
  );
}

export const tenantConfig = {
  platformDomain,
  devFirmSubdomain: devFirmSubdomain ?? null,
} as const;
