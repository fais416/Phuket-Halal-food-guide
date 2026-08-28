# AI TikTok Shop Auto Director

Turn any accessible product link into a complete AI video advertisement. Paste a product URL,
click **DIRECT MY PRODUCT**, and the app reads the page, finds and validates a real product photo,
sends that photo into Claude Vision, then has an AI "commercial director" decide target audience,
strategy, hook, full shot-by-shot storyboard (camera/lighting/environment), voice-over, CTA, and
TikTok captions — and generates copy-ready Google Flow/Veo prompts for every shot.

## What was built

- **Next.js 14 (App Router) + TypeScript** web app, Tailwind UI.
- **Real SSRF-hardened fetching** (`src/lib/security/ssrfGuard.ts`): HTTPS-only, blocks
  localhost/private/reserved IPs (including literal-IP payloads like `169.254.169.254`, the
  classic cloud-metadata SSRF target — Node skips its DNS hook entirely for IP-literal hosts, so
  this is checked explicitly), DNS-rebinding-safe custom lookup, redirect validation, request
  timeout, and response-size caps.
- **productFetcher / productParser**: server-side HTML fetch with categorized failure reasons
  (bot-blocked, auth-required, 404, JS-only shell, etc. — never a generic "cannot read"), and
  layered extraction (JSON-LD → Schema.org → Open Graph → meta → visible HTML) with nothing
  invented.
- **imageExtractor / imageValidator**: finds every plausible product image (JSON-LD, og:image,
  twitter:image, `src`/`srcset`/`data-src`/`data-original`/`data-lazy-src`/`data-srcset`), ranks
  them (penalizing logos/icons/trackers/unrelated DOM context, rewarding gallery context and large
  declared dimensions), then downloads and validates candidates in ranked order until enough good
  ones are found.
- **AI provider: Anthropic Claude** (`src/lib/ai/client.ts`) — chosen because it accepts a real
  downloaded image (base64) plus text in one request, and structured JSON output is enforced via
  forced tool-use (not "please output JSON" prompting).
- **productVisionAnalyzer**: sends the actual image bytes to Claude Vision; returns `null`/
  `"unknown"` rather than guessing.
- **productVerifier / productReferenceBuilder**: builds the Product Reference Profile with every
  field tagged `VERIFIED` / `VISUAL` / `AI_INFERENCE` / `UNKNOWN` — an inference can never be
  silently upgraded to verified.
- **autoDirector / storyboardGenerator / shotDirector**: one holistic, structured Claude call
  decides audience, strategy (+2 alternatives), hook, full storyboard, voice-over need, CTA, and
  captions, grounded explicitly in the confidence-tagged product data; deterministic
  post-processing normalizes shot timing continuity and clamps camera/lighting/environment to safe
  enum values.
- **flowPromptGenerator**: deterministic template (not another AI call) that guarantees every shot
  prompt includes the Product Consistency Engine's mandatory clauses and negative instructions,
  every time.
- **qualityController**: rule-based QC pass that strips unsupported-claim language, fixes missing
  transitions/zero-duration shots, and rebuilds the prompt before anything is shown.
- **Streaming pipeline** (`app/api/direct/route.ts` + `src/lib/pipeline/orchestrator.ts`): NDJSON
  progress events so the UI's processing steps reflect real backend work, not a fake timer.
- **UI**: minimal homepage (URL input + optional fallback image upload), live processing status,
  results view with confidence badges, per-shot Flow prompts, copy buttons, and a
  `DOWNLOAD PROMPT PACKAGE` export (`01_PRODUCT_DATA` … `14_CAPTION`, via JSZip).

## Install

```bash
npm install
```

## Set the API key

Copy `.env.example` to `.env.local` and fill in a real Anthropic API key:

```bash
cp .env.example .env.local
```

```
AI_API_KEY=sk-ant-...           # required — https://console.anthropic.com/settings/keys
AI_MODEL=claude-sonnet-4-5-20250929   # optional — must be a vision-capable Claude 3.x/4.x model
DEBUG_MODE=false                # optional — true exposes the technical debug trace
```

Without `AI_API_KEY`, the app does **not** pretend to work — every request returns a clear
`AI_NOT_CONFIGURED` error with setup instructions instead of a fake result.

## Run

```bash
npm run dev       # http://localhost:3000
npm run build && npm run start   # production
```

## Testing this build

- `npm run lint` and `npm run typecheck` — both pass.
- `npm run build` — production build succeeds.
- Pipeline logic was exercised directly (not just "does the UI render"):
  - **Parser/extractor**: fed realistic synthetic HTML (JSON-LD + OG + gallery `<img>`s + a logo +
    a 1×1 tracking pixel + a "related products" image) — confirmed correct field extraction with
    accurate `VERIFIED` tagging and source attribution, and correct image ranking (logo/tracker
    scored negative, gallery images scored highest).
  - **SSRF guard**: confirmed `http://`, `file://`, malformed URLs, credentialed URLs, `localhost`,
    and `[::1]` are all rejected at the synchronous format-check stage; confirmed `safeFetch`
    itself blocks `127.0.0.1`, `10.0.0.1`, and the cloud metadata IP `169.254.169.254` before any
    connection is attempted. **This testing found and fixed two real bugs**: `127.0.0.1` was
    missing from the blocked-hostname set, and — more importantly — a URL whose host is already a
    literal IP address bypassed the DNS-based guard entirely (Node's `http`/`net` stack connects
    directly to a literal IP without ever invoking the custom `lookup` function), which would have
    let `https://169.254.169.254/...` (or any internal IP) straight through. Both are fixed; the
    literal-IP case is now checked synchronously before any request is made.
  - **API route end-to-end**: ran the real Next.js server and posted to `/api/direct` — verified
    `NO_INPUT`, `SSRF_BLOCKED` (with the specific reason, not a generic message), and
    `PAGE_UNREACHABLE`/DNS-failure responses.
  - **AI Vision call path**: posted a real generated PNG as an uploaded image against the real
    `api.anthropic.com` endpoint (reachable from this build environment) with a placeholder key —
    confirmed the request actually reaches Anthropic, gets a real `401 authentication_error`, and
    that error is caught and surfaced as `VISION_FAILED` with the true underlying reason rather
    than a generic failure message.
  - **Quality controller**: ran `runQualityControl` against a synthetic direction containing
    deliberately unsupported claims ("the best in the world", "guaranteed 100%", "#1"), a missing
    transition, and a zero-duration shot — confirmed all were auto-fixed and every generated Flow
    prompt contained the mandatory Product Consistency and Negative Instructions blocks.

### What could not be tested here

This build environment's outbound network access is restricted to an allowlist that does not
include arbitrary e-commerce domains (Shopee/Lazada/Shopify/etc. are unreachable from here), and no
real Anthropic API key was available. So the **full happy path** — a real product page → real
extracted image → real Claude Vision analysis → real director-generated storyboard — has not been
exercised end-to-end, only each stage individually (see above) plus the exact real-world failure
mode (auth error) for the parts that could reach the network. Test this yourself with:

```bash
cp .env.example .env.local   # add a real AI_API_KEY
npm run dev
# paste a real product URL (e.g. a Shopify store product page) and click DIRECT MY PRODUCT
```

## Known limitations

- **No headless browser / JS execution.** Storefronts that render entirely client-side (no data
  in the initial HTML) cannot be read; the app detects this and reports it explicitly rather than
  silently failing, and offers the image-upload fallback.
- **No login/paywall support.** Pages requiring authentication are reported as `REQUIRES_AUTH`
  with fallback upload offered.
- **Bot protection (Cloudflare/Akamai/etc.)** on some storefronts will block the fetch; reported as
  `BOT_BLOCKED`.
- **One holistic AI call** produces target audience, strategy, hook, shots, voice-over, CTA, and
  captions together (rather than as fully independent module calls) so the creative story stays
  coherent end to end and API cost/latency stay bounded; deterministic modules
  (`shotDirector`, `flowPromptGenerator`, `voiceOverGenerator`, `ctaGenerator`,
  `captionGenerator`, `qualityController`) still validate/normalize/finalize that output
  independently.
- **No persistence.** Nothing is stored server-side; each request is stateless and results only
  exist in the browser session (export via the download/copy buttons).
- **Google Flow/Veo integration is prompt-only** (as specified) — no live API call to a video
  generator; each shot gets a `COPY FLOW PROMPT` button for pasting into Google Flow/Veo manually.
- `npm audit` reports a few advisories in `postcss`, a nested build-time dependency of Next.js
  itself (not a runtime/user-facing attack surface); resolving them requires an upstream Next.js
  major-version bump, out of scope here.
