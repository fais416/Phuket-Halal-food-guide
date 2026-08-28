// flowPromptGenerator: builds the final, copy-ready Google Flow/Veo prompt
// for each shot. Deterministic (template-driven), NOT another AI call —
// this is what guarantees the Product Consistency Engine's mandatory
// clauses are present in literally every shot, every time, verbatim.

import type { AdDirection, ProductReferenceProfile, Shot } from "@/lib/types";

const PRODUCT_CONSISTENCY_BLOCK = [
  "Use the provided product image as the exact visual reference.",
  "Preserve the exact product identity, proportions, shape, colors, logo, branding, texture, stitching, hardware, zipper, straps and all visible details.",
  "Do not redesign the product.",
  "Do not change the product color.",
  "Do not alter the logo.",
  "Do not add or remove product components.",
  "Maintain consistent product appearance across all shots.",
].join(" ");

const NEGATIVE_INSTRUCTIONS = [
  "product redesign",
  "wrong colors",
  "wrong logo",
  "distorted text",
  "extra product parts",
  "missing product parts",
  "warped geometry",
  "unrealistic movement",
  "unrealistic proportions",
  "text artifacts",
  "watermarks",
].join(", ");

function subjectLine(profile: ProductReferenceProfile): string {
  const name = profile.productName.value ?? profile.visual?.product_category ?? "the product";
  const brand = profile.brand.value ? `by ${profile.brand.value}` : "";
  return `${name} ${brand}`.trim();
}

function productReferenceLine(profile: ProductReferenceProfile): string {
  const bits: string[] = [];
  if (profile.colors.value?.length) bits.push(`colors: ${profile.colors.value.join(", ")}`);
  if (profile.shape.value) bits.push(`shape: ${profile.shape.value}`);
  if (profile.visualStyle.value) bits.push(`style: ${profile.visualStyle.value}`);
  if (profile.visibleDetails.value?.length) bits.push(`visible details: ${profile.visibleDetails.value.join(", ")}`);
  return bits.length ? bits.join("; ") : "match the attached product reference photo exactly";
}

export function buildFlowPrompt(shot: Shot, profile: ProductReferenceProfile): string {
  const lines = [
    `SUBJECT: ${subjectLine(profile)} — ${shot.visual}`,
    `PRODUCT REFERENCE: ${productReferenceLine(profile)}`,
    `ENVIRONMENT: ${shot.environment.setting}`,
    `ACTION: ${shot.action}`,
    `CAMERA: ${shot.camera.shot}`,
    `LENS LOOK: ${shot.camera.lensLook}`,
    `CAMERA MOVEMENT: ${shot.camera.movement}`,
    `LIGHTING: ${shot.lighting.type}, ${shot.lighting.direction}, ${shot.lighting.quality}, intensity ${shot.lighting.intensity}, mood ${shot.lighting.mood}`,
    `COMPOSITION: ${shot.composition}`,
    `DEPTH OF FIELD: ${shot.depthOfField}`,
    `FOCUS: ${shot.focus}`,
    `MOOD: ${shot.mood}`,
    `PRODUCT CONSISTENCY: ${PRODUCT_CONSISTENCY_BLOCK}`,
    `NEGATIVE INSTRUCTIONS: avoid ${NEGATIVE_INSTRUCTIONS}.`,
    `FORMAT: Vertical 9:16, photorealistic, commercial product video, natural realistic motion, realistic lighting. Duration ${(shot.timeEnd - shot.timeStart).toFixed(1)}s.`,
  ];
  return lines.join("\n");
}

export function buildAllFlowPrompts(direction: AdDirection, profile: ProductReferenceProfile): Map<number, string> {
  const map = new Map<number, string>();
  for (const shot of direction.shots) {
    map.set(shot.index, buildFlowPrompt(shot, profile));
  }
  return map;
}

export { PRODUCT_CONSISTENCY_BLOCK, NEGATIVE_INSTRUCTIONS };
