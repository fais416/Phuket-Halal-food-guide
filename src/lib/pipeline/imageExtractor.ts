// imageExtractor: finds every plausible product-photo URL on the page and
// ranks them, instead of grabbing the first <img> it sees.

import * as cheerio from "cheerio";
import type { CandidateImage } from "@/lib/types";

const NEGATIVE_FILENAME_WORDS = [
  "logo",
  "favicon",
  "icon",
  "sprite",
  "avatar",
  "banner",
  "badge",
  "pixel",
  "tracking",
  "placeholder",
  "spinner",
  "loading",
  "blank",
  "1x1",
];
const NEGATIVE_CONTEXT_WORDS = [
  "review",
  "recommend",
  "related",
  "footer",
  "header",
  "nav",
  "sidebar",
  "avatar",
  "logo",
  "seller",
  "shop-logo",
  "advert",
  "banner",
  "cookie",
];
const POSITIVE_CONTEXT_WORDS = [
  "product",
  "gallery",
  "main-image",
  "hero",
  "detail",
  "zoom",
  "carousel",
  "slide",
];

function collectJsonLdImages($: cheerio.CheerioAPI): string[] {
  const urls: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw?.trim()) return;
    try {
      const parsed = JSON.parse(raw);
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      const walk = (n: unknown) => {
        if (!n || typeof n !== "object") return;
        const obj = n as Record<string, unknown>;
        if (Array.isArray(obj["@graph"])) (obj["@graph"] as unknown[]).forEach(walk);
        const img = obj["image"];
        if (typeof img === "string") urls.push(img);
        else if (Array.isArray(img)) img.forEach((i) => typeof i === "string" && urls.push(i));
        else if (img && typeof img === "object") {
          const u = (img as Record<string, unknown>)["url"];
          if (typeof u === "string") urls.push(u);
        }
      };
      nodes.forEach(walk);
    } catch {
      // skip malformed JSON-LD
    }
  });
  return urls;
}

function bestFromSrcset(srcset: string): string | null {
  const entries = srcset
    .split(",")
    .map((s) => s.trim())
    .map((s) => {
      const [url, size] = s.split(/\s+/);
      const width = size?.endsWith("w") ? parseInt(size, 10) : 0;
      return { url, width: Number.isFinite(width) ? width : 0 };
    })
    .filter((e) => e.url);
  if (!entries.length) return null;
  entries.sort((a, b) => b.width - a.width);
  return entries[0]!.url ?? null;
}

function toAbsolute(src: string, base: string): string | null {
  try {
    const abs = new URL(src, base);
    if (abs.protocol !== "https:" && abs.protocol !== "http:") return null;
    return abs.toString();
  } catch {
    return null;
  }
}

function scoreCandidate(params: {
  url: string;
  source: string;
  alt?: string;
  width?: number;
  height?: number;
  contextClasses: string;
}): { score: number; reasons: string[] } {
  const { url, source, alt, width, height, contextClasses } = params;
  let score = 0;
  const reasons: string[] = [];

  const sourceWeight: Record<string, number> = {
    "json-ld": 60,
    "og:image": 55,
    "twitter:image": 40,
    img: 20,
    srcset: 22,
    "data-src": 18,
    "data-original": 18,
    "data-lazy-src": 18,
    "data-srcset": 20,
  };
  score += sourceWeight[source] ?? 10;
  reasons.push(`source:${source}(+${sourceWeight[source] ?? 10})`);

  const lowerUrl = url.toLowerCase();
  if (NEGATIVE_FILENAME_WORDS.some((w) => lowerUrl.includes(w))) {
    score -= 50;
    reasons.push("filename looks like logo/icon/tracking(-50)");
  }
  const lowerCtx = contextClasses.toLowerCase();
  if (NEGATIVE_CONTEXT_WORDS.some((w) => lowerCtx.includes(w))) {
    score -= 30;
    reasons.push("DOM context looks unrelated to product(-30)");
  }
  if (POSITIVE_CONTEXT_WORDS.some((w) => lowerCtx.includes(w))) {
    score += 25;
    reasons.push("DOM context suggests product gallery(+25)");
  }

  const lowerAlt = (alt ?? "").toLowerCase();
  if (lowerAlt && !["logo", "icon", "avatar", "banner"].some((w) => lowerAlt.includes(w))) {
    score += 8;
    reasons.push("has descriptive alt text(+8)");
  }

  if (width && height) {
    if (width >= 500 && height >= 500) {
      score += 20;
      reasons.push(`large declared size ${width}x${height}(+20)`);
    } else if (width < 100 || height < 100) {
      score -= 25;
      reasons.push(`tiny declared size ${width}x${height}(-25)`);
    }
  }

  if (/w=\d{3,4}|width=\d{3,4}|_(?:large|zoom|full|xl)\b/i.test(lowerUrl)) {
    score += 6;
    reasons.push("URL hints at a large/zoom variant(+6)");
  }
  if (/w=\d{1,2}\b|_(?:thumb|small|mini|sm)\b/i.test(lowerUrl)) {
    score -= 10;
    reasons.push("URL hints at a thumbnail(-10)");
  }

  return { score, reasons };
}

export function extractCandidateImages(html: string, pageUrl: string): CandidateImage[] {
  const $ = cheerio.load(html);
  const byUrl = new Map<string, CandidateImage>();

  const add = (rawUrl: string | undefined | null, source: string, extra: Partial<CandidateImage> = {}) => {
    if (!rawUrl) return;
    const abs = toAbsolute(rawUrl, pageUrl);
    if (!abs) return;
    if (byUrl.has(abs)) return; // keep first (higher-priority source wins since we call in priority order)
    const contextClasses = extra.reasons?.join(" ") ?? "";
    const { score, reasons } = scoreCandidate({
      url: abs,
      source,
      alt: extra.alt,
      width: extra.width,
      height: extra.height,
      contextClasses,
    });
    byUrl.set(abs, { url: abs, score, reasons, width: extra.width, height: extra.height, alt: extra.alt, source });
  };

  for (const u of collectJsonLdImages($)) add(u, "json-ld");
  add($('meta[property="og:image:secure_url"]').first().attr("content"), "og:image");
  add($('meta[property="og:image"]').first().attr("content"), "og:image");
  add($('meta[name="twitter:image"]').first().attr("content"), "twitter:image");

  $("img").each((_, el) => {
    const $el = $(el);
    const contextClasses = [
      $el.attr("class"),
      $el.attr("id"),
      $el.closest("[class]").attr("class"),
      $el.parent().attr("class"),
    ]
      .filter(Boolean)
      .join(" ");
    const alt = $el.attr("alt");
    const width = Number($el.attr("width")) || undefined;
    const height = Number($el.attr("height")) || undefined;

    const candidates: Array<[string | undefined, string]> = [
      [$el.attr("src"), "img"],
      [$el.attr("data-src"), "data-src"],
      [$el.attr("data-original"), "data-original"],
      [$el.attr("data-lazy-src"), "data-lazy-src"],
    ];
    for (const [val, source] of candidates) {
      if (val) add(val, source, { alt, width, height, reasons: [contextClasses] });
    }
    const srcset = $el.attr("srcset");
    if (srcset) {
      const best = bestFromSrcset(srcset);
      if (best) add(best, "srcset", { alt, width, height, reasons: [contextClasses] });
    }
    const dataSrcset = $el.attr("data-srcset");
    if (dataSrcset) {
      const best = bestFromSrcset(dataSrcset);
      if (best) add(best, "data-srcset", { alt, width, height, reasons: [contextClasses] });
    }
  });

  return Array.from(byUrl.values()).sort((a, b) => b.score - a.score);
}
