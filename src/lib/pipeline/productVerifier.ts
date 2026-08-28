// productVerifier: the single place that decides a field's DataConfidence
// tag. Kept separate from productReferenceBuilder so the "what counts as
// verified vs. inferred" policy lives in one auditable spot.

import type { ConfidenceField, DataConfidence } from "@/lib/types";

/** Prefer a page-verified value; fall back to a visually-observed one; else UNKNOWN. */
export function preferVerifiedOverVisual<T>(
  verifiedValue: T | null | undefined,
  visualValue: T | null | undefined
): ConfidenceField<T> {
  if (verifiedValue !== null && verifiedValue !== undefined) {
    return { value: verifiedValue, confidence: "VERIFIED" };
  }
  if (visualValue !== null && visualValue !== undefined) {
    return { value: visualValue, confidence: "VISUAL" };
  }
  return { value: null, confidence: "UNKNOWN" };
}

export function asInference<T>(value: T | null | undefined): ConfidenceField<T> {
  if (value === null || value === undefined) return { value: null, confidence: "UNKNOWN" };
  return { value, confidence: "AI_INFERENCE" };
}

/** Guards against a caller accidentally re-labeling an inference as verified. */
export function assertNeverUpgraded(from: DataConfidence, to: DataConfidence): void {
  if (from === "AI_INFERENCE" && to === "VERIFIED") {
    throw new Error("Invalid confidence transition: AI_INFERENCE can never become VERIFIED.");
  }
  if (from === "UNKNOWN" && (to === "VERIFIED" || to === "VISUAL")) {
    throw new Error(`Invalid confidence transition: UNKNOWN can never become ${to}.`);
  }
}
