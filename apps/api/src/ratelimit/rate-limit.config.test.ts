import { describe, expect, it } from "vitest";
import { resolveTrustedProxies } from "./rate-limit.config.js";

describe("resolveTrustedProxies", () => {
  it("production without the variable refuses to start", () => {
    expect(() => resolveTrustedProxies(undefined, true)).toThrow(/TRUSTED_PROXIES must be set/);
    expect(() => resolveTrustedProxies("", true)).toThrow(/TRUSTED_PROXIES must be set/);
    expect(() => resolveTrustedProxies("   ", true)).toThrow(/TRUSTED_PROXIES must be set/);
  });

  it("development without the variable trusts nothing", () => {
    expect(resolveTrustedProxies(undefined, false)).toEqual({ kind: "none" });
  });

  it('"none" is accepted in production, in any case', () => {
    expect(resolveTrustedProxies("none", true)).toEqual({ kind: "none" });
    expect(resolveTrustedProxies(" None ", true)).toEqual({ kind: "none" });
  });

  it("a list of addresses and ranges is parsed", () => {
    const resolved = resolveTrustedProxies("10.0.0.1, 10.0.1.0/24,2001:db8::/32", true);
    expect(resolved.kind).toBe("list");
    if (resolved.kind === "list") {
      expect(resolved.ranges.map((r) => r.text)).toEqual(["10.0.0.1", "10.0.1.0/24", "2001:db8::/32"]);
    }
  });

  it("a range that would trust every client is rejected", () => {
    expect(() => resolveTrustedProxies("0.0.0.0/0", true)).toThrow(/every IPv4 address/);
    expect(() => resolveTrustedProxies("::/0", true)).toThrow(/trusts everything/);
    expect(() => resolveTrustedProxies("10.0.0.1, 0.0.0.0/0", true)).toThrow(/every IPv4 address/);
  });

  it("an entry that is not an address or range is rejected by name", () => {
    expect(() => resolveTrustedProxies("proxy.internal", true)).toThrow(/"proxy.internal" is not/);
    expect(() => resolveTrustedProxies("10.0.0.0/33", true)).toThrow(/"10.0.0.0\/33" is not/);
  });
});
