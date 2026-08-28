// productVisionAnalyzer: sends the actual downloaded product image (base64)
// into Claude Vision and returns a structured, non-hallucinated analysis.

import { callStructuredWithImage, AiNotConfiguredError, AiCallFailedError } from "@/lib/ai/client";
import type { VisionAnalysis } from "@/lib/types";

export class VisionAnalysisError extends Error {
  code = "VISION_FAILED" as const;
}

const SCHEMA = {
  type: "object",
  properties: {
    product_category: { type: ["string", "null"] },
    product_name: { type: ["string", "null"] },
    colors: { type: "array", items: { type: "string" } },
    shape: { type: ["string", "null"] },
    visible_material: { type: ["string", "null"] },
    logo: { type: ["string", "null"] },
    branding: { type: ["string", "null"] },
    visible_details: { type: "array", items: { type: "string" } },
    visual_style: { type: ["string", "null"] },
    possible_use_cases: { type: "array", items: { type: "string" } },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: [
    "product_category",
    "product_name",
    "colors",
    "shape",
    "visible_material",
    "logo",
    "branding",
    "visible_details",
    "visual_style",
    "possible_use_cases",
    "confidence",
  ],
};

const SYSTEM_PROMPT = `You are a product-photo analyst. You are shown ONE real photo of a physical product.
Report only what you can actually SEE in the image. Never invent brand names, materials, or
details that are not visibly present. If something cannot be confidently determined from the
pixels in front of you, you MUST use null (for single values) or "unknown" (inside array items
where a null is not valid) rather than guessing. Do not use outside knowledge about what the
product "probably" is beyond what is visibly depicted.`;

export async function analyzeProductImage(
  imageBase64: string,
  contentType: string
): Promise<VisionAnalysis> {
  const mediaType = contentType as "image/jpeg" | "image/png" | "image/webp";

  try {
    const result = await callStructuredWithImage<VisionAnalysis>({
      system: SYSTEM_PROMPT,
      prompt:
        "Analyze the attached product photo and call the `report_product_vision` tool with your findings. " +
        "Base every field strictly on what is visible in this image.",
      imageBase64,
      imageMediaType: mediaType,
      toolName: "report_product_vision",
      toolDescription: "Report structured, evidence-based observations about the product shown in the image.",
      schema: SCHEMA,
      maxTokens: 1024,
    });
    return result;
  } catch (err) {
    if (err instanceof AiNotConfiguredError) throw err;
    const detail = err instanceof AiCallFailedError ? err.message : String(err);
    throw new VisionAnalysisError(`The AI Vision model could not process the image. ${detail}`);
  }
}
