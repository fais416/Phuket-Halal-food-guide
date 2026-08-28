// productParser: turns fetched HTML into ProductPageData.
//
// Reads in priority order — JSON-LD Product schema, then Open Graph /
// meta tags, then visible HTML heuristics — and never invents a value: a
// field that isn't found anywhere stays UNKNOWN.

import * as cheerio from "cheerio";
import type { ProductPageData } from "@/lib/types";
import { unknownField, verified } from "@/lib/types";

interface RawFields {
  name?: string;
  brand?: string;
  description?: string;
  price?: string;
  currency?: string;
  availability?: string;
  sku?: string;
  variants?: string[];
  specifications?: Record<string, string>;
}

function collectJsonLd($: cheerio.CheerioAPI): unknown[] {
  const nodes: unknown[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw || !raw.trim()) return;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) nodes.push(...parsed);
      else nodes.push(parsed);
    } catch {
      // Malformed JSON-LD on the page — skip it rather than guessing.
    }
  });
  return nodes;
}

function flattenGraph(nodes: unknown[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const n of nodes) {
    if (n && typeof n === "object") {
      const obj = n as Record<string, unknown>;
      if (Array.isArray(obj["@graph"])) {
        out.push(...flattenGraph(obj["@graph"] as unknown[]));
      } else {
        out.push(obj);
      }
    }
  }
  return out;
}

function typeIncludes(obj: Record<string, unknown>, type: string): boolean {
  const t = obj["@type"];
  if (typeof t === "string") return t.toLowerCase() === type.toLowerCase();
  if (Array.isArray(t)) return t.some((x) => typeof x === "string" && x.toLowerCase() === type.toLowerCase());
  return false;
}

function asString(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number") return String(v);
  return undefined;
}

function extractFromJsonLd($: cheerio.CheerioAPI): RawFields | null {
  const nodes = flattenGraph(collectJsonLd($));
  const product = nodes.find((n) => typeIncludes(n, "Product"));
  if (!product) return null;

  const fields: RawFields = {};
  fields.name = asString(product["name"]);
  const brand = product["brand"];
  if (typeof brand === "string") fields.brand = brand;
  else if (brand && typeof brand === "object") fields.brand = asString((brand as Record<string, unknown>)["name"]);
  fields.description = asString(product["description"]);
  fields.sku = asString(product["sku"]) ?? asString(product["mpn"]);

  let offer = product["offers"];
  if (Array.isArray(offer)) offer = offer[0];
  if (offer && typeof offer === "object") {
    const o = offer as Record<string, unknown>;
    fields.price = asString(o["price"]) ?? asString(o["lowPrice"]);
    fields.currency = asString(o["priceCurrency"]);
    const avail = asString(o["availability"]);
    if (avail) fields.availability = avail.replace(/^https?:\/\/schema\.org\//i, "");
  }

  if (Array.isArray(product["hasVariant"])) {
    const variants = (product["hasVariant"] as unknown[])
      .map((v) => (v && typeof v === "object" ? asString((v as Record<string, unknown>)["name"]) : undefined))
      .filter((v): v is string => Boolean(v));
    if (variants.length) fields.variants = variants;
  }

  const additional = product["additionalProperty"];
  if (Array.isArray(additional)) {
    const specs: Record<string, string> = {};
    for (const p of additional) {
      if (p && typeof p === "object") {
        const po = p as Record<string, unknown>;
        const k = asString(po["name"]);
        const v = asString(po["value"]);
        if (k && v) specs[k] = v;
      }
    }
    if (Object.keys(specs).length) fields.specifications = specs;
  }

  return fields;
}

function extractFromMeta($: cheerio.CheerioAPI): RawFields {
  const get = (selector: string) => $(selector).first().attr("content")?.trim();
  const fields: RawFields = {
    name: get('meta[property="og:title"]') ?? get('meta[name="twitter:title"]') ?? ($("title").first().text().trim() || undefined),
    description: get('meta[property="og:description"]') ?? get('meta[name="description"]'),
    price:
      get('meta[property="product:price:amount"]') ??
      get('meta[property="og:price:amount"]') ??
      get('meta[itemprop="price"]'),
    currency: get('meta[property="product:price:currency"]') ?? get('meta[property="og:price:currency"]'),
    brand: get('meta[property="product:brand"]') ?? get('meta[itemprop="brand"]'),
    availability: get('meta[property="product:availability"]'),
  };
  return fields;
}

const PRICE_PATTERN = /(?:฿|\$|€|£|USD|THB|EUR|GBP)\s?[\d,]+(?:\.\d+)?|[\d,]+(?:\.\d+)?\s?(?:฿|บาท|USD|THB)/i;

function extractFromVisibleHtml($: cheerio.CheerioAPI): RawFields {
  const fields: RawFields = {};

  if (!fields.name) {
    const h1 = $("h1").first().text().trim();
    if (h1) fields.name = h1;
  }

  const priceSelectors = [
    '[itemprop="price"]',
    ".price",
    ".product-price",
    "[class*='price']",
    "[data-price]",
  ];
  for (const sel of priceSelectors) {
    const text = $(sel).first().text().trim();
    if (text && PRICE_PATTERN.test(text)) {
      fields.price = text.match(PRICE_PATTERN)?.[0]?.trim() ?? text;
      break;
    }
  }

  return fields;
}

export function parseProductPage(html: string, url: string): ProductPageData {
  const $ = cheerio.load(html);

  const jsonLd = extractFromJsonLd($);
  const meta = extractFromMeta($);
  const visible = extractFromVisibleHtml($);

  const sourceSignals: Record<string, string> = {};
  const pick = (key: keyof RawFields): { value: unknown; source: string } | null => {
    if (jsonLd && jsonLd[key] !== undefined) return { value: jsonLd[key], source: "json-ld" };
    if (meta[key] !== undefined) return { value: meta[key], source: "meta/og" };
    if (visible[key] !== undefined) return { value: visible[key], source: "html" };
    return null;
  };

  const nameHit = pick("name");
  const brandHit = pick("brand");
  const descHit = pick("description");
  const priceHit = pick("price");
  const currencyHit = pick("currency");
  const availabilityHit = pick("availability");
  const skuHit = pick("sku");
  const variantsHit = pick("variants");
  const specsHit = pick("specifications");

  if (nameHit) sourceSignals.name = nameHit.source;
  if (brandHit) sourceSignals.brand = brandHit.source;
  if (descHit) sourceSignals.description = descHit.source;
  if (priceHit) sourceSignals.price = priceHit.source;
  if (currencyHit) sourceSignals.currency = currencyHit.source;
  if (availabilityHit) sourceSignals.availability = availabilityHit.source;
  if (skuHit) sourceSignals.sku = skuHit.source;
  if (variantsHit) sourceSignals.variants = variantsHit.source;
  if (specsHit) sourceSignals.specifications = specsHit.source;

  return {
    name: verified(nameHit?.value as string | undefined),
    brand: verified(brandHit?.value as string | undefined),
    description: verified(descHit?.value as string | undefined),
    price: verified(priceHit?.value as string | undefined),
    currency: verified(currencyHit?.value as string | undefined),
    availability: verified(availabilityHit?.value as string | undefined),
    sku: verified(skuHit?.value as string | undefined),
    variants: variantsHit ? verified(variantsHit.value as string[]) : unknownField(),
    specifications: specsHit ? verified(specsHit.value as Record<string, string>) : unknownField(),
    url,
    sourceSignals,
  };
}

export function hasUsableProductData(data: ProductPageData): boolean {
  return data.name.value !== null || data.description.value !== null;
}
