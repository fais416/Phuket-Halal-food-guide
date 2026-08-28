// autoDirector: the "Commercial Director" brain. One holistic structured
// call decides target audience, strategy, hook, full shot-by-shot
// storyboard (camera/lighting/environment/composition/etc.), whether a
// voice-over is warranted, the CTA, and captions — all grounded in the
// Product Reference Profile so the story stays coherent end to end (a
// single creative pass, rather than independent calls per section, is what
// keeps the hook/shots/CTA telling the same story).

import { callStructured, AiNotConfiguredError, AiCallFailedError } from "@/lib/ai/client";
import type { AdDirection, DurationOption, ProductReferenceProfile } from "@/lib/types";
import { describeProductReferenceForPrompt } from "@/lib/pipeline/productReferenceBuilder";

export class DirectorError extends Error {
  code = "AI_CALL_FAILED" as const;
}

const STRATEGY_ENUM = [
  "Viral TikTok",
  "UGC",
  "Product Showcase",
  "Lifestyle",
  "Premium Commercial",
  "Product Review",
  "Problem-Solution",
  "Unboxing",
  "Emotional",
];
const HOOK_TYPE_ENUM = ["Visual Hook", "Spoken Hook", "Product Reveal", "Camera Movement Hook", "Text Hook"];
const CAMERA_SHOT_ENUM = ["Macro", "Close-up", "Medium", "Wide", "Top-down", "Low angle", "Eye level"];
const CAMERA_MOVEMENT_ENUM = ["Slow push-in", "Orbit", "Dolly", "Tracking", "Pan", "Tilt", "Crane", "Rack focus", "Static"];
const LIGHTING_ENUM = ["Natural sunlight", "Soft studio", "Golden hour", "Dramatic", "High-key", "Low-key", "Luxury"];
const TONE_ENUM = ["Friendly", "Premium", "Energetic", "Natural", "Confident", "UGC"];

const strategyObject = {
  type: "object",
  properties: {
    strategy: { type: "string", enum: STRATEGY_ENUM },
    whyItFits: { type: "string" },
  },
  required: ["strategy", "whyItFits"],
};

const shotSchema = {
  type: "object",
  properties: {
    index: { type: "integer" },
    timeStart: { type: "number" },
    timeEnd: { type: "number" },
    purpose: { type: "string" },
    visual: { type: "string", description: "What is visually depicted in this shot." },
    action: { type: "string", description: "What happens/moves during this shot." },
    camera: {
      type: "object",
      properties: {
        shot: { type: "string", enum: CAMERA_SHOT_ENUM },
        movement: { type: "string", enum: CAMERA_MOVEMENT_ENUM },
        lensLook: { type: "string", description: "e.g. 35mm crisp commercial look, shallow depth of field" },
      },
      required: ["shot", "movement", "lensLook"],
    },
    lighting: {
      type: "object",
      properties: {
        type: { type: "string", enum: LIGHTING_ENUM },
        direction: { type: "string" },
        quality: { type: "string" },
        intensity: { type: "string" },
        mood: { type: "string" },
      },
      required: ["type", "direction", "quality", "intensity", "mood"],
    },
    environment: {
      type: "object",
      properties: {
        setting: { type: "string" },
        reason: { type: "string", description: "One short sentence on why this setting fits the product." },
      },
      required: ["setting", "reason"],
    },
    composition: { type: "string" },
    depthOfField: { type: "string" },
    focus: { type: "string" },
    mood: { type: "string" },
    transition: { type: "string", description: "Transition INTO the next shot, e.g. 'hard cut', 'whip pan'." },
    voiceOverLine: { type: ["string", "null"] },
    onScreenText: { type: ["string", "null"] },
  },
  required: [
    "index",
    "timeStart",
    "timeEnd",
    "purpose",
    "visual",
    "action",
    "camera",
    "lighting",
    "environment",
    "composition",
    "depthOfField",
    "focus",
    "mood",
    "transition",
    "voiceOverLine",
    "onScreenText",
  ],
};

const captionVariant = {
  type: "object",
  properties: {
    text: { type: "string" },
    hashtags: { type: "array", items: { type: "string" } },
  },
  required: ["text", "hashtags"],
};

const DIRECTION_SCHEMA = {
  type: "object",
  properties: {
    targetAudience: { type: "string" },
    mainStrategy: strategyObject,
    alternativeStrategies: { type: "array", items: strategyObject, minItems: 2, maxItems: 2 },
    hook: {
      type: "object",
      properties: {
        type: { type: "string", enum: HOOK_TYPE_ENUM },
        description: { type: "string" },
        onScreenText: { type: ["string", "null"] },
        spokenLine: { type: ["string", "null"] },
      },
      required: ["type", "description", "onScreenText", "spokenLine"],
    },
    shots: { type: "array", items: shotSchema, minItems: 3, maxItems: 9 },
    voiceOver: {
      type: "object",
      properties: {
        needed: { type: "boolean" },
        tone: { type: ["string", "null"], enum: [...TONE_ENUM, null] },
        script: { type: ["string", "null"], description: "Thai-language voice-over script if needed." },
        musicSuggestion: { type: ["string", "null"] },
        reason: { type: "string" },
      },
      required: ["needed", "tone", "script", "musicSuggestion", "reason"],
    },
    cta: {
      type: "object",
      properties: {
        text: { type: "string", description: "Thai-language CTA for TikTok Shop." },
        reason: { type: "string" },
      },
      required: ["text", "reason"],
    },
    captions: {
      type: "object",
      properties: {
        viral: captionVariant,
        productFocus: captionVariant,
        softSell: captionVariant,
      },
      required: ["viral", "productFocus", "softSell"],
    },
  },
  required: ["targetAudience", "mainStrategy", "alternativeStrategies", "hook", "shots", "voiceOver", "cta", "captions"],
};

function durationInstruction(duration: DurationOption): string {
  if (duration === "15") {
    return "Total video duration MUST be exactly 15 seconds. Choose however many shots (3-6) best fit that budget; timeStart/timeEnd across all shots must run from 0 to 15 with no gaps or overlaps.";
  }
  if (duration === "30") {
    return "Total video duration MUST be exactly 30 seconds. Choose however many shots (5-9) best fit that budget; timeStart/timeEnd across all shots must run from 0 to 30 with no gaps or overlaps.";
  }
  return "Choose whichever total duration (15 or 30 seconds) best fits this product and strategy, and choose the shot count accordingly. timeStart/timeEnd across all shots must run from 0 to your chosen total with no gaps or overlaps.";
}

const SYSTEM_PROMPT = `You are an award-winning commercial director who specializes in short-form TikTok Shop
product ads. You are given a Product Reference Profile with fields explicitly labeled VERIFIED
(from the real product page), VISUAL (seen in the real product photo), or UNKNOWN. You must:

- Decide the target audience, main strategy (+2 distinct alternative strategies with reasons),
  a scroll-stopping 0-3s hook, a full shot-by-shot storyboard, whether a voice-over is warranted,
  a TikTok Shop CTA, and 3 caption variants — entirely on your own judgment. The end user supplied
  nothing but the product link/photo; do not ask them anything.
- Every shot must keep the SAME physical product visible and unchanged — you are directing
  camera/lighting/environment/performance around the product, never redesigning it.
- NEVER state an UNKNOWN fact (exact materials, certifications, performance numbers, medical or
  efficacy claims) as if verified. Do not invent superlatives ("the best", "guaranteed", "#1")
  unless that exact claim is present in the VERIFIED data.
- Voice-over script (if needed) must be natural Thai. CTA and captions must be Thai, appropriate
  for TikTok Shop (e.g. inviting the viewer to tap the cart/basket), and never overstate what is
  known about the product.
- Keep pacing fast and native to TikTok: quick cuts, an attention-grabbing hook, no dead air.`;

export async function generateAdDirection(
  profile: ProductReferenceProfile,
  duration: DurationOption
): Promise<AdDirection> {
  const profileText = describeProductReferenceForPrompt(profile);
  const prompt = `${profileText}

Duration requirement: ${durationInstruction(duration)}

Call the \`direct_advertisement\` tool with your complete creative direction.`;

  try {
    const result = await callStructured<AdDirection>({
      system: SYSTEM_PROMPT,
      prompt,
      toolName: "direct_advertisement",
      toolDescription: "Submit the complete commercial direction for this product's TikTok Shop ad.",
      schema: DIRECTION_SCHEMA,
      maxTokens: 8192,
    });
    return result;
  } catch (err) {
    if (err instanceof AiNotConfiguredError) throw err;
    const detail = err instanceof AiCallFailedError ? err.message : String(err);
    throw new DirectorError(`The AI director could not generate a creative direction. ${detail}`);
  }
}
