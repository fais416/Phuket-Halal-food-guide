// productFetcher: server-side retrieval of a product page's HTML.
//
// Only ever reads what is publicly served — no login, no JS execution, no
// headless browser. That means JS-only storefronts will legitimately fail
// here (see PipelineFetchError code "BOT_BLOCKED"/"REQUIRES_AUTH"), and the
// caller is expected to surface the *real* reason rather than a generic
// "cannot read" message.

import { safeFetch, MAX_HTML_BYTES, SsrfBlockedError, FetchTimeoutError, NetworkError, ResponseTooLargeError, validateUrlFormat } from "@/lib/security/ssrfGuard";

export type FetchFailureCode =
  | "INVALID_URL"
  | "SSRF_BLOCKED"
  | "TIMEOUT"
  | "NOT_FOUND"
  | "REQUIRES_AUTH"
  | "BOT_BLOCKED"
  | "SERVER_ERROR"
  | "TOO_LARGE"
  | "NETWORK_ERROR"
  | "NOT_HTML";

export class ProductFetchError extends Error {
  code: FetchFailureCode;
  constructor(code: FetchFailureCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface FetchedProductPage {
  html: string;
  finalUrl: string;
  status: number;
}

export async function fetchProductPage(rawUrl: string): Promise<FetchedProductPage> {
  const formatCheck = validateUrlFormat(rawUrl);
  if (!formatCheck.ok) {
    throw new ProductFetchError(formatCheck.code, formatCheck.reason);
  }

  let result;
  try {
    result = await safeFetch(rawUrl, { maxBytes: MAX_HTML_BYTES, method: "GET" });
  } catch (err) {
    if (err instanceof SsrfBlockedError) {
      throw new ProductFetchError(
        "SSRF_BLOCKED",
        "This link points to a private, internal, or otherwise disallowed network address and was blocked for security reasons."
      );
    }
    if (err instanceof FetchTimeoutError) {
      throw new ProductFetchError(
        "TIMEOUT",
        "The product page took too long to respond and the request timed out."
      );
    }
    if (err instanceof ResponseTooLargeError) {
      throw new ProductFetchError(
        "TOO_LARGE",
        "The product page response was too large to process safely."
      );
    }
    if (err instanceof NetworkError) {
      throw new ProductFetchError(
        "NETWORK_ERROR",
        `Could not connect to the product page (${err.message}).`
      );
    }
    throw new ProductFetchError("NETWORK_ERROR", "An unexpected network error occurred.");
  }

  if (result.status === 404 || result.status === 410) {
    throw new ProductFetchError("NOT_FOUND", "The product page returned a 404/410 — it does not exist or was removed.");
  }
  if (result.status === 401 || result.status === 403) {
    // 403 is ambiguous: could be bot-protection (Cloudflare/Akamai/etc.) or
    // an auth wall. Sniff the body for common tells before deciding.
    const bodySnippet = result.body.toString("utf-8", 0, Math.min(result.body.length, 4000)).toLowerCase();
    const authTells = ["sign in", "log in", "login required", "please log in", "authentication required"];
    const botTells = ["captcha", "cloudflare", "access denied", "attention required", "checking your browser", "bot detection", "akamai"];
    if (authTells.some((t) => bodySnippet.includes(t))) {
      throw new ProductFetchError("REQUIRES_AUTH", "The product page requires the visitor to be logged in, so it could not be read publicly.");
    }
    if (botTells.some((t) => bodySnippet.includes(t)) || result.status === 403) {
      throw new ProductFetchError("BOT_BLOCKED", "The website's bot/security protection blocked this request (e.g. Cloudflare or similar challenge).");
    }
    throw new ProductFetchError("REQUIRES_AUTH", "The product page denied access (HTTP 401).");
  }
  if (result.status === 429) {
    throw new ProductFetchError("BOT_BLOCKED", "The website is rate-limiting automated requests (HTTP 429).");
  }
  if (result.status >= 500) {
    throw new ProductFetchError("SERVER_ERROR", `The product page's server returned an error (HTTP ${result.status}).`);
  }
  if (result.status >= 400) {
    throw new ProductFetchError("SERVER_ERROR", `The product page returned HTTP ${result.status}.`);
  }

  const contentType = result.headers["content-type"] ?? "";
  if (!contentType.includes("html") && !contentType.includes("xml") && contentType !== "") {
    throw new ProductFetchError("NOT_HTML", `The URL did not return an HTML page (content-type: ${contentType}).`);
  }

  const html = result.body.toString("utf-8");

  // A handful of storefronts serve a near-empty HTML shell and render
  // everything client-side. We can't execute JS, so detect this and report
  // it accurately instead of pretending the page was read successfully.
  const strippedText = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (strippedText.length < 200 && html.length > 500) {
    throw new ProductFetchError(
      "BOT_BLOCKED",
      "The product page appears to render its content with JavaScript and returned almost no readable HTML on first load."
    );
  }

  return { html, finalUrl: result.finalUrl, status: result.status };
}
