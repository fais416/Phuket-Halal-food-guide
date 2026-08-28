// productReferenceBuilder: merges page data + vision analysis into the
// Product Reference Profile — the single source of truth the Auto Director
// works from. Implements the VERIFIED / VISUAL / AI_INFERENCE / UNKNOWN
// split described in the spec: a value's confidence tag is set by WHERE it
// came from and is never upgraded.

import type {
  PrimaryImage,
  ProductPageData,
  ProductReferenceProfile,
  ValidatedImage,
  VisionAnalysis,
} from "@/lib/types";
import { unknownField } from "@/lib/types";
import { preferVerifiedOverVisual } from "@/lib/pipeline/productVerifier";

export function buildProductReferenceProfile(params: {
  productPage: ProductPageData | null;
  vision: VisionAnalysis | null;
  primaryImage: PrimaryImage;
  secondaryImages: ValidatedImage[];
}): ProductReferenceProfile {
  const { productPage, vision, primaryImage, secondaryImages } = params;

  const productName = preferVerifiedOverVisual(productPage?.name.value, vision?.product_name);

  const brand = productPage?.brand.value != null ? productPage.brand : unknownField<string>();

  const colors = vision?.colors?.length
    ? { value: vision.colors, confidence: "VISUAL" as const }
    : unknownField<string[]>();

  const shape = vision?.shape ? { value: vision.shape, confidence: "VISUAL" as const } : unknownField<string>();

  const visualStyle = vision?.visual_style
    ? { value: vision.visual_style, confidence: "VISUAL" as const }
    : unknownField<string>();

  const visibleDetails = vision?.visible_details?.length
    ? { value: vision.visible_details, confidence: "VISUAL" as const }
    : unknownField<string[]>();

  return {
    primaryImage,
    secondaryImages,
    productName,
    brand,
    verified: productPage,
    visual: vision,
    colors,
    shape,
    visualStyle,
    visibleDetails,
  };
}

/** Human-readable summary block fed into AI prompts, keeping confidence tags explicit. */
export function describeProductReferenceForPrompt(profile: ProductReferenceProfile): string {
  const lines: string[] = [];

  lines.push("=== VERIFIED DATA (from the product page itself) ===");
  if (profile.verified) {
    const v = profile.verified;
    lines.push(`Name: ${v.name.value ?? "UNKNOWN"}`);
    lines.push(`Brand: ${v.brand.value ?? "UNKNOWN"}`);
    lines.push(`Description: ${v.description.value ?? "UNKNOWN"}`);
    lines.push(`Price: ${v.price.value ?? "UNKNOWN"} ${v.currency.value ?? ""}`.trim());
    lines.push(`Availability: ${v.availability.value ?? "UNKNOWN"}`);
    if (v.variants.value?.length) lines.push(`Variants: ${v.variants.value.join(", ")}`);
    if (v.specifications.value) {
      lines.push(`Specifications: ${Object.entries(v.specifications.value).map(([k, val]) => `${k}=${val}`).join(", ")}`);
    }
  } else {
    lines.push("(no product page data — this run is image-only)");
  }

  lines.push("");
  lines.push("=== VISUAL DATA (observed by AI Vision in the actual product photo) ===");
  if (profile.visual) {
    const v = profile.visual;
    lines.push(`Category: ${v.product_category ?? "unknown"}`);
    lines.push(`Colors: ${v.colors.length ? v.colors.join(", ") : "unknown"}`);
    lines.push(`Shape: ${v.shape ?? "unknown"}`);
    lines.push(`Visible material: ${v.visible_material ?? "unknown"}`);
    lines.push(`Logo: ${v.logo ?? "unknown"}`);
    lines.push(`Branding: ${v.branding ?? "unknown"}`);
    lines.push(`Visible details: ${v.visible_details.length ? v.visible_details.join(", ") : "unknown"}`);
    lines.push(`Visual style: ${v.visual_style ?? "unknown"}`);
    lines.push(`Possible use cases (AI observation, not a claim): ${v.possible_use_cases.join(", ") || "unknown"}`);
    lines.push(`Vision model confidence: ${v.confidence}`);
  } else {
    lines.push("(no product image was analyzed — no visual data available)");
  }

  lines.push("");
  lines.push(
    "Any field not listed above as VERIFIED or VISUAL is UNKNOWN. You (the director) may reason " +
      "about target audience and strategy as AI_INFERENCE, but you must never state an UNKNOWN " +
      "fact (e.g. exact material, certifications, performance claims) as if it were verified."
  );

  return lines.join("\n");
}
