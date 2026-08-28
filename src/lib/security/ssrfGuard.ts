// SSRF protection for all outbound fetches made by this app (product pages
// and product images). This module is deliberately conservative: it only
// allows public, HTTPS, GET-able hosts, and it locks DNS resolution to the
// same address it validates (so a hostname cannot resolve to something
// private *after* the check but *before* the connection — a classic
// DNS-rebinding bypass of a "validate then fetch separately" approach).
//
// Everything here runs server-side only (Next.js Route Handlers / Node
// runtime). Never import this from client code.

import * as https from "node:https";
import * as dns from "node:dns";
import * as net from "node:net";
import type { LookupAddress } from "node:dns";

export const REQUEST_TIMEOUT_MS = 12_000;
export const MAX_REDIRECTS = 5;
export const MAX_HTML_BYTES = 3 * 1024 * 1024; // 3 MB
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB

export class SsrfBlockedError extends Error {
  code = "SSRF_BLOCKED" as const;
}
export class FetchTimeoutError extends Error {
  code = "TIMEOUT" as const;
}
export class ResponseTooLargeError extends Error {
  code = "TOO_LARGE" as const;
}
export class NetworkError extends Error {
  code = "NETWORK_ERROR" as const;
  cause?: unknown;
}

const BLOCKED_HOSTNAME_SUFFIXES = [
  ".local",
  ".localhost",
  ".internal",
  ".intranet",
  ".corp",
  ".home",
  ".lan",
];
const BLOCKED_HOSTNAMES = new Set(["localhost", "0.0.0.0", "127.0.0.1", "::1", "[::1]"]);

export type UrlFormatCheck =
  | { ok: true; url: URL }
  | { ok: false; reason: string; code: "INVALID_URL" | "SSRF_BLOCKED" };

/** Synchronous, pre-network checks on a raw URL string. */
export function validateUrlFormat(raw: string): UrlFormatCheck {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "The link is not a valid URL.", code: "INVALID_URL" };
  }

  if (url.protocol !== "https:") {
    return {
      ok: false,
      reason:
        "Only HTTPS product links are supported. Plain HTTP, file://, and other protocols are rejected for security reasons.",
      code: "INVALID_URL",
    };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "URLs containing embedded credentials are not allowed.", code: "INVALID_URL" };
  }
  const hostname = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { ok: false, reason: "Links to localhost or loopback addresses are not allowed.", code: "SSRF_BLOCKED" };
  }
  if (BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    return { ok: false, reason: "Links to internal/private network hostnames are not allowed.", code: "SSRF_BLOCKED" };
  }

  // Critical: when the URL's host is already a literal IP address, Node's
  // net/http stack connects directly to it WITHOUT ever calling the custom
  // `lookup` function passed to https.request — so the DNS-based guard in
  // safeLookup() below would never even run for a payload like
  // "https://169.254.169.254/". Catch that case here, synchronously.
  const bareHost = hostname.replace(/^\[|\]$/, "").replace(/\]$/, "");
  const ipVersion = net.isIP(bareHost);
  if (ipVersion === 4 && isPrivateIPv4(bareHost)) {
    return { ok: false, reason: "Links to private/internal/reserved IP addresses are not allowed.", code: "SSRF_BLOCKED" };
  }
  if (ipVersion === 6 && isPrivateIPv6(bareHost)) {
    return { ok: false, reason: "Links to private/internal/reserved IP addresses are not allowed.", code: "SSRF_BLOCKED" };
  }

  return { ok: true, url };
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = (n << 8) + v;
  }
  return n >>> 0;
}

function isPrivateIPv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return true; // fail closed
  const inRange = (base: string, maskBits: number) => {
    const b = ipv4ToInt(base)!;
    const mask = maskBits === 0 ? 0 : (~0 << (32 - maskBits)) >>> 0;
    return (n & mask) === (b & mask);
  };
  return (
    inRange("0.0.0.0", 8) ||
    inRange("10.0.0.0", 8) ||
    inRange("100.64.0.0", 10) ||
    inRange("127.0.0.0", 8) ||
    inRange("169.254.0.0", 16) ||
    inRange("172.16.0.0", 12) ||
    inRange("192.0.0.0", 24) ||
    inRange("192.0.2.0", 24) ||
    inRange("192.168.0.0", 16) ||
    inRange("198.18.0.0", 15) ||
    inRange("198.51.100.0", 24) ||
    inRange("203.0.113.0", 24) ||
    inRange("224.0.0.0", 4) ||
    inRange("240.0.0.0", 4)
  );
}

function ipv6ToBigInt(ip: string): bigint | null {
  let addr = ip;
  // Embedded IPv4, e.g. "::ffff:192.168.1.1"
  const v4Match = addr.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Match) {
    const v4 = ipv4ToInt(v4Match[1]!);
    if (v4 === null) return null;
    const hex = v4.toString(16).padStart(8, "0");
    addr = addr.slice(0, addr.length - v4Match[1]!.length) + `${hex.slice(0, 4)}:${hex.slice(4)}`;
  }
  const parts = addr.split("::");
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(":").filter(Boolean) : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(":").filter(Boolean) : [];
  const missing = 8 - head.length - tail.length;
  if (parts.length === 1 && missing !== 0) return null;
  if (missing < 0) return null;
  const groups = [...head, ...Array(parts.length === 2 ? missing : 0).fill("0"), ...tail];
  if (groups.length !== 8) return null;
  let result = 0n;
  for (const g of groups) {
    const v = parseInt(g || "0", 16);
    if (Number.isNaN(v) || v < 0 || v > 0xffff) return null;
    result = (result << 16n) | BigInt(v);
  }
  return result;
}

function isPrivateIPv6(ip: string): boolean {
  const clean = ip.replace(/^\[|\]$/g, "");
  const v4Embedded = clean.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Embedded && (clean.startsWith("::ffff:") || clean.startsWith("::"))) {
    if (isPrivateIPv4(v4Embedded[1]!)) return true;
  }
  const n = ipv6ToBigInt(clean);
  if (n === null) return true; // fail closed
  if (n === 0n) return true; // ::
  if (n === 1n) return true; // ::1
  const shifted7 = n >> 121n; // top 7 bits -> fc00::/7 unique local
  if (shifted7 === 0b1111110n || shifted7 === 0b1111111n) return true;
  const shifted10 = n >> 118n; // top 10 bits -> fe80::/10 link local
  if (shifted10 === 0b1111111010n) return true;
  return false;
}

function isPrivateAddress(address: string, family: number): boolean {
  return family === 6 ? isPrivateIPv6(address) : isPrivateIPv4(address);
}

/**
 * Custom `lookup` used by https.request. Resolves the hostname, validates
 * every candidate address, and only ever hands the connection a *public*
 * address — so the address actually connected to is the one that was
 * validated (no TOCTOU gap between a separate "check" step and the fetch).
 */
function safeLookup(
  hostname: string,
  _options: unknown,
  callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void
): void {
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses: LookupAddress[]) => {
    if (err) {
      callback(err, "", 4);
      return;
    }
    if (!addresses || addresses.length === 0) {
      callback(new Error("DNS resolution returned no addresses"), "", 4);
      return;
    }
    const publicAddr = addresses.find((a) => !isPrivateAddress(a.address, a.family));
    if (!publicAddr) {
      const e = new Error(
        `Host "${hostname}" resolves only to private/internal network addresses.`
      ) as NodeJS.ErrnoException;
      e.code = "SSRF_BLOCKED";
      callback(e, "", 4);
      return;
    }
    callback(null, publicAddr.address, publicAddr.family);
  });
}

export interface SafeFetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
  method?: "GET" | "HEAD";
  headers?: Record<string, string>;
}

export interface SafeFetchResult {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  finalUrl: string;
}

export async function safeFetch(rawUrl: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const maxBytes = opts.maxBytes ?? MAX_HTML_BYTES;
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const method = opts.method ?? "GET";

  let currentUrl = rawUrl;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    const check = validateUrlFormat(currentUrl);
    if (!check.ok) {
      throw new SsrfBlockedError(check.reason);
    }
    const url = check.url;

    const result = await new Promise<SafeFetchResult | { redirectTo: string }>((resolve, reject) => {
      const req = https.request(
        {
          hostname: url.hostname,
          port: 443,
          path: `${url.pathname}${url.search}`,
          method,
          lookup: safeLookup,
          timeout: timeoutMs,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (compatible; AITikTokShopAutoDirector/1.0; +https://example.invalid/bot)",
            Accept: opts.headers?.Accept ?? "text/html,application/xhtml+xml,*/*;q=0.8",
            "Accept-Language": "th,en;q=0.8",
            ...opts.headers,
          },
        },
        (res) => {
          const status = res.statusCode ?? 0;
          if ([301, 302, 303, 307, 308].includes(status)) {
            const location = res.headers.location;
            res.resume();
            if (!location) {
              reject(new NetworkError(`Redirect (${status}) without a Location header.`));
              return;
            }
            const nextUrl = new URL(location, url).toString();
            resolve({ redirectTo: nextUrl });
            return;
          }

          const chunks: Buffer[] = [];
          let total = 0;
          res.on("data", (chunk: Buffer) => {
            total += chunk.length;
            if (total > maxBytes) {
              res.destroy();
              reject(new ResponseTooLargeError(`Response exceeded ${maxBytes} bytes.`));
              return;
            }
            chunks.push(chunk);
          });
          res.on("end", () => {
            const headers: Record<string, string> = {};
            for (const [k, v] of Object.entries(res.headers)) {
              if (typeof v === "string") headers[k] = v;
              else if (Array.isArray(v)) headers[k] = v.join(", ");
            }
            resolve({
              status,
              headers,
              body: Buffer.concat(chunks),
              finalUrl: url.toString(),
            });
          });
          res.on("error", (e) => reject(new NetworkError(e.message)));
        }
      );

      req.on("timeout", () => {
        req.destroy();
        reject(new FetchTimeoutError(`Request to ${url.hostname} timed out after ${timeoutMs}ms.`));
      });
      req.on("error", (e: NodeJS.ErrnoException) => {
        if (e.code === "SSRF_BLOCKED") {
          reject(new SsrfBlockedError(e.message));
        } else {
          reject(new NetworkError(e.message));
        }
      });
      req.end();
    });

    if ("redirectTo" in result) {
      currentUrl = result.redirectTo;
      continue;
    }
    return result;
  }

  throw new NetworkError(`Too many redirects (limit ${MAX_REDIRECTS}).`);
}
