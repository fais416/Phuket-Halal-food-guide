// shotDirector: defensive validation/normalization of the camera, lighting
// and environment choices the AI director made for each shot. The AI is
// asked for enum values via the tool schema, but nothing forces strict
// compliance, so this module clamps anything out-of-vocabulary to a safe
// default rather than shipping a broken shot.

import type { CameraPlan, EnvironmentPlan, LightingPlan, Shot } from "@/lib/types";

const CAMERA_SHOTS: CameraPlan["shot"][] = ["Macro", "Close-up", "Medium", "Wide", "Top-down", "Low angle", "Eye level"];
const CAMERA_MOVEMENTS: CameraPlan["movement"][] = [
  "Slow push-in",
  "Orbit",
  "Dolly",
  "Tracking",
  "Pan",
  "Tilt",
  "Crane",
  "Rack focus",
  "Static",
];
const LIGHTING_TYPES: LightingPlan["type"][] = [
  "Natural sunlight",
  "Soft studio",
  "Golden hour",
  "Dramatic",
  "High-key",
  "Low-key",
  "Luxury",
];

function clampEnum<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : fallback;
}

export function normalizeCamera(camera: Partial<CameraPlan> | undefined): CameraPlan {
  return {
    shot: clampEnum(camera?.shot, CAMERA_SHOTS, "Medium"),
    movement: clampEnum(camera?.movement, CAMERA_MOVEMENTS, "Static"),
    lensLook: camera?.lensLook?.trim() || "35mm commercial look, shallow depth of field",
  };
}

export function normalizeLighting(lighting: Partial<LightingPlan> | undefined): LightingPlan {
  return {
    type: clampEnum(lighting?.type, LIGHTING_TYPES, "Soft studio"),
    direction: lighting?.direction?.trim() || "45-degree key light",
    quality: lighting?.quality?.trim() || "soft, diffused",
    intensity: lighting?.intensity?.trim() || "medium",
    mood: lighting?.mood?.trim() || "clean and inviting",
  };
}

export function normalizeEnvironment(environment: Partial<EnvironmentPlan> | undefined): EnvironmentPlan {
  return {
    setting: environment?.setting?.trim() || "Minimal studio",
    reason: environment?.reason?.trim() || "Keeps full attention on the product with no distractions.",
  };
}

/** Re-sequences shot indexes and rescales timing so the storyboard is contiguous with no gaps/overlaps. */
export function normalizeShotTimings(shots: Shot[], targetTotalSeconds: number): Shot[] {
  const sorted = [...shots].sort((a, b) => a.timeStart - b.timeStart);
  const rawDurations = sorted.map((s) => Math.max(0.5, s.timeEnd - s.timeStart));
  const rawTotal = rawDurations.reduce((a, b) => a + b, 0) || sorted.length;

  let cursor = 0;
  return sorted.map((shot, i) => {
    const scaled = (rawDurations[i]! / rawTotal) * targetTotalSeconds;
    const timeStart = Math.round(cursor * 10) / 10;
    cursor += scaled;
    const timeEnd = i === sorted.length - 1 ? targetTotalSeconds : Math.round(cursor * 10) / 10;
    return {
      ...shot,
      index: i + 1,
      timeStart,
      timeEnd,
      camera: normalizeCamera(shot.camera),
      lighting: normalizeLighting(shot.lighting),
      environment: normalizeEnvironment(shot.environment),
    };
  });
}
