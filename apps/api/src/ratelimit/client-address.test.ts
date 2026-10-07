import { describe, expect, it } from "vitest";
import {
  normalise,
  parseAddress,
  parseRange,
  resolveClientAddress,
  type TrustedProxies,
} from "./client-address.js";

const none: TrustedProxies = { kind: "none" };

function trusting(...ranges: string[]): TrustedProxies {
  return {
    kind: "list",
    ranges: ranges.map((text) => {
      const range = parseRange(text);
      if (!range) throw new Error(`bad range ${text}`);
      return range;
    }),
  };
}

describe("resolveClientAddress", () => {
  it("with no trusted proxies, the header is ignored however it is written", () => {
    expect(resolveClientAddress("203.0.113.9", "1.2.3.4", none)).toBe("203.0.113.9");
    expect(resolveClientAddress("203.0.113.9", "1.2.3.4, 5.6.7.8", none)).toBe("203.0.113.9");
    expect(resolveClientAddress("203.0.113.9", undefined, none)).toBe("203.0.113.9");
  });

  it("a peer that is not a trusted proxy cannot forge an address", () => {
    const trusted = trusting("10.0.0.0/8");
    expect(resolveClientAddress("203.0.113.9", "1.2.3.4", trusted)).toBe("203.0.113.9");
  });

  it("a trusted proxy's header yields the rightmost untrusted address", () => {
    const trusted = trusting("10.0.0.1");
    expect(resolveClientAddress("10.0.0.1", "198.51.100.7", trusted)).toBe("198.51.100.7");
  });

  it("a forged address pre-loaded by the client is to the left and never reached", () => {
    const trusted = trusting("10.0.0.1");
    // The client sent "X-Forwarded-For: 1.1.1.1"; the proxy appended the real peer.
    expect(resolveClientAddress("10.0.0.1", "1.1.1.1, 198.51.100.7", trusted)).toBe("198.51.100.7");
  });

  it("walks back through a chain of trusted proxies", () => {
    const trusted = trusting("10.0.0.0/24", "10.0.1.0/24");
    expect(
      resolveClientAddress("10.0.0.1", "1.1.1.1, 198.51.100.7, 10.0.1.5", trusted),
    ).toBe("198.51.100.7");
  });

  it("falls back to the peer when the header names only proxies or is empty", () => {
    const trusted = trusting("10.0.0.0/24");
    expect(resolveClientAddress("10.0.0.1", "10.0.0.2", trusted)).toBe("10.0.0.1");
    expect(resolveClientAddress("10.0.0.1", "", trusted)).toBe("10.0.0.1");
    expect(resolveClientAddress("10.0.0.1", undefined, trusted)).toBe("10.0.0.1");
  });

  it("a malformed entry ends what the proxies vouched for", () => {
    const trusted = trusting("10.0.0.1");
    expect(resolveClientAddress("10.0.0.1", "not-an-ip, 10.0.0.1", trusted)).toBe("10.0.0.1");
    expect(resolveClientAddress("10.0.0.1", "198.51.100.7, not-an-ip", trusted)).toBe("10.0.0.1");
  });

  it("handles IPv6 peers and ranges", () => {
    const trusted = trusting("2001:db8::/32");
    expect(resolveClientAddress("2001:db8::1", "2001:db8:ffff::2, 2001:4860::8888", trusted)).toBe(
      "2001:4860::8888",
    );
    expect(resolveClientAddress("2001:db9::1", "2001:4860::8888", trusted)).toBe("2001:db9::1");
  });

  it("one spelling per address: mapped IPv4 collapses to dotted form", () => {
    expect(resolveClientAddress("::ffff:203.0.113.9", undefined, none)).toBe("203.0.113.9");
    expect(normalise("::FFFF:10.0.0.1")).toBe("10.0.0.1");
    expect(normalise("2001:DB8:0:0:0:0:0:1")).toBe("2001:db8:0:0:0:0:0:1");
    expect(normalise("2001:db8::1")).toBe("2001:db8:0:0:0:0:0:1");
  });

  it("an IPv4 range covers the mapped form of its members", () => {
    const trusted = trusting("10.0.0.0/8");
    expect(resolveClientAddress("::ffff:10.1.2.3", "198.51.100.7", trusted)).toBe("198.51.100.7");
  });
});

describe("parseRange / parseAddress", () => {
  it("accepts addresses, v4 and v6 ranges", () => {
    expect(parseRange("10.0.0.1")?.bits).toBe(128);
    expect(parseRange("10.0.0.0/8")?.bits).toBe(96 + 8);
    expect(parseRange("2001:db8::/32")?.bits).toBe(32);
  });

  it("refuses what is not a range", () => {
    for (const bad of ["", "10.0.0.0/33", "2001:db8::/129", "10.0.0.0/8/1", "proxy", "10.0.0.0/x"]) {
      expect(parseRange(bad), bad).toBeUndefined();
    }
  });

  it("parses embedded and compressed forms", () => {
    expect(parseAddress("::ffff:1.2.3.4")).toBe(parseAddress("1.2.3.4"));
    expect(parseAddress("::1")).toBe(1n);
    expect(parseAddress("::")).toBe(0n);
    expect(parseAddress("1:2:3:4:5:6:7:8:9")).toBeUndefined();
    expect(parseAddress("1::2::3")).toBeUndefined();
  });
});
