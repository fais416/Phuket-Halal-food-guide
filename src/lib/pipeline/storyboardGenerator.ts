// storyboardGenerator: orchestrates the director call and applies
// deterministic normalization (timing continuity, enum safety) on top of
// the AI's creative choices.

import type { AdDirection, DurationOption, ProductReferenceProfile } from "@/lib/types";
import { generateAdDirection } from "@/lib/pipeline/autoDirector";
import { normalizeShotTimings } from "@/lib/pipeline/shotDirector";

export async function generateStoryboard(
  profile: ProductReferenceProfile,
  duration: DurationOption
): Promise<AdDirection> {
  const direction = await generateAdDirection(profile, duration);

  const inferredTotal =
    duration === "15" ? 15 : duration === "30" ? 30 : Math.max(...direction.shots.map((s) => s.timeEnd), 15);
  const targetTotal = duration === "auto" ? (inferredTotal <= 20 ? 15 : 30) : Number(duration);

  return {
    ...direction,
    shots: normalizeShotTimings(direction.shots, targetTotal),
  };
}
