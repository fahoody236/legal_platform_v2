import type { IncomingMessage } from "node:http";
import { isIP } from "node:net";

/**
 * Which address a request came from, and when a header may say otherwise.
 *
 * ── The rule ─────────────────────────────────────────────────────────────────
 *
 * The socket peer is the only address the server can vouch for. Behind a
 * reverse proxy that peer is the proxy, and every user becomes one address —
 * at which point a per-address limit on sign-in is a limit on the whole firm.
 * So the proxy's `X-Forwarded-For` has to be read, and the question is when.
 *
 * Only when the peer is a configured proxy. The header is otherwise ignored
 * outright: a client that connects directly and sends one is lying, and the
 * lie is discarded without being parsed. When the peer is a proxy, the header
 * is read from the right — the address the proxy itself appended is the
 * rightmost, and anything to its left was written by whoever was upstream,
 * including the client. The first address from the right that is not itself
 * a trusted proxy is the client. A chain of two trusted proxies therefore
 * resolves correctly, and a client that pre-loads the header with a forged
 * address ends up with that forgery to the left of its real address, where
 * it is never reached.
 *
 * ── The configuration is the control ─────────────────────────────────────────
 *
 * `TRUSTED_PROXIES` is a comma-separated list of addresses or CIDR ranges, or
 * the literal `none`. In production it must be set; see rate-limit.config.ts.
 * A forgotten setting is how a whole firm becomes one address, and a setting
 * that trusts too much is how one client becomes any address it likes.
 */

export type TrustedProxies =
  | { kind: "none" }
  | { kind: "list"; ranges: readonly Range[] };

export interface Range {
  /** The network address, as a 128-bit value; IPv4 mapped into ::ffff:0:0/96. */
  network: bigint;
  /** Prefix length in the 128-bit space. */
  bits: number;
  text: string;
}

const ALL_ONES = (1n << 128n) - 1n;
const V4_MAPPED_PREFIX = 0xffffn << 32n;

/** An address as a 128-bit integer, or undefined if it is not one. */
export function parseAddress(text: string): bigint | undefined {
  const trimmed = text.trim();
  const version = isIP(trimmed);

  if (version === 4) {
    return V4_MAPPED_PREFIX | parseV4(trimmed);
  }

  if (version === 6) {
    return parseV6(trimmed);
  }

  return undefined;
}

function parseV4(text: string): bigint {
  // isIP(4) has validated the shape: four decimal octets.
  return text
    .split(".")
    .reduce((value, octet) => (value << 8n) | BigInt(Number(octet)), 0n);
}

function parseV6(text: string): bigint | undefined {
  // Zone index (`fe80::1%eth0`) is link-local detail, not part of the address.
  const bare = text.split("%")[0] ?? text;

  // Embedded IPv4 in the last group: `::ffff:192.0.2.1`.
  const lastColon = bare.lastIndexOf(":");
  const tail = bare.slice(lastColon + 1);
  if (tail.includes(".")) {
    if (isIP(tail) !== 4) return undefined;
    const v4 = parseV4(tail);
    const head = bare.slice(0, lastColon + 1);
    const high = (v4 >> 16n).toString(16);
    const low = (v4 & 0xffffn).toString(16);
    return parseV6(`${head}${high}:${low}`);
  }

  const halves = bare.split("::");
  if (halves.length > 2) return undefined;

  const groups = (part: string) =>
    part === "" ? [] : part.split(":").map((group) => parseInt(group, 16));

  const left = groups(halves[0] ?? "");
  const right = halves.length === 2 ? groups(halves[1] ?? "") : [];
  const missing = 8 - left.length - right.length;

  if (missing < 0 || (halves.length === 1 && missing !== 0)) return undefined;
  if ([...left, ...right].some((group) => Number.isNaN(group) || group > 0xffff)) {
    return undefined;
  }

  const all = [...left, ...new Array<number>(missing).fill(0), ...right];
  return all.reduce((value, group) => (value << 16n) | BigInt(group), 0n);
}

/** `192.0.2.0/24`, `10.0.0.1`, `2001:db8::/32` — a single address is a /32 or /128. */
export function parseRange(text: string): Range | undefined {
  const [addressText, bitsText, ...rest] = text.trim().split("/");
  if (!addressText || rest.length > 0) return undefined;

  const address = parseAddress(addressText);
  if (address === undefined) return undefined;

  const isV4 = isIP(addressText.trim()) === 4;
  let bits: number;

  if (bitsText === undefined) {
    bits = 128;
  } else {
    const parsed = Number(bitsText);
    const max = isV4 ? 32 : 128;
    if (!/^\d+$/.test(bitsText) || parsed > max) return undefined;
    // IPv4 prefixes live in the low 32 bits of the mapped space.
    bits = isV4 ? parsed + 96 : parsed;
  }

  const mask = bits === 0 ? 0n : (ALL_ONES << BigInt(128 - bits)) & ALL_ONES;
  return { network: address & mask, bits, text: text.trim() };
}

export function inRange(address: bigint, range: Range): boolean {
  const mask =
    range.bits === 0 ? 0n : (ALL_ONES << BigInt(128 - range.bits)) & ALL_ONES;
  return (address & mask) === range.network;
}

function isTrusted(addressText: string, trusted: TrustedProxies): boolean {
  if (trusted.kind === "none") return false;
  const address = parseAddress(addressText);
  if (address === undefined) return false;
  return trusted.ranges.some((range) => inRange(address, range));
}

/**
 * The client's address, by the rule above. `socketAddress` is what the
 * connection reports; `forwardedFor` the raw header, if any.
 *
 * Returns the socket address whenever the header cannot be used: no trusted
 * proxies, a peer that is not one, an absent or empty header, or a header in
 * which every entry is a proxy (which means the proxy saw no client address,
 * and the proxy is the closest thing to one).
 */
export function resolveClientAddress(
  socketAddress: string | undefined,
  forwardedFor: string | string[] | undefined,
  trusted: TrustedProxies,
): string {
  const peer = normalise(socketAddress ?? "");

  if (peer === "" || !isTrusted(peer, trusted)) {
    return peer || "unknown";
  }

  const header = Array.isArray(forwardedFor)
    ? forwardedFor.join(",")
    : (forwardedFor ?? "");
  const hops = header
    .split(",")
    .map((hop) => normalise(hop))
    .filter((hop) => hop !== "");

  for (let index = hops.length - 1; index >= 0; index -= 1) {
    const hop = hops[index];
    if (hop === undefined) continue;
    // Not an address at all: a malformed entry a proxy would not have
    // written, so it was written upstream. Treat it as the end of what the
    // proxies vouched for and take the proxy's own peer instead.
    if (isIP(hop) === 0) return peer;
    if (!isTrusted(hop, trusted)) return hop;
  }

  return peer;
}

/**
 * One spelling per address, so a counter keyed by it cannot be split by
 * writing the same address two ways: `::ffff:10.0.0.1` becomes `10.0.0.1`,
 * and an IPv6 address is canonicalised through the parser.
 */
export function normalise(text: string): string {
  const trimmed = text.trim();
  if (trimmed === "") return "";

  const version = isIP(trimmed);
  if (version === 4) return trimmed;
  if (version !== 6) return trimmed.toLowerCase();

  const value = parseAddress(trimmed);
  if (value === undefined) return trimmed.toLowerCase();

  if (value >> 32n === V4_MAPPED_PREFIX >> 32n) {
    const v4 = value & 0xffffffffn;
    return [24n, 16n, 8n, 0n]
      .map((shift) => ((v4 >> shift) & 0xffn).toString())
      .join(".");
  }

  const groups: string[] = [];
  for (let shift = 112n; shift >= 0n; shift -= 16n) {
    groups.push(((value >> shift) & 0xffffn).toString(16));
  }
  return groups.join(":");
}

/**
 * Carried on the request under a symbol, like the firm and the session, so
 * nothing can forge it by assigning a plausible property. Set once by the
 * address middleware; everything after reads it from here.
 */
const CLIENT_ADDRESS = Symbol("legal.client-address");

export interface AddressedRequest extends IncomingMessage {
  [CLIENT_ADDRESS]?: string;
}

export function setClientAddress(
  request: AddressedRequest,
  address: string,
): void {
  request[CLIENT_ADDRESS] = address;
}

/**
 * Falls back to the socket when the middleware has not run — /health is
 * excluded from it — so a caller always gets something keyable, and never
 * the forwarded header unvetted.
 */
export function clientAddressOf(request: AddressedRequest): string {
  return (
    request[CLIENT_ADDRESS] ??
    (normalise(request.socket.remoteAddress ?? "") || "unknown")
  );
}
