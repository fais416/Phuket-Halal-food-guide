// voiceOverGenerator: validates/formats the director's voice-over decision.
// The creative decision itself comes from autoDirector's single holistic
// call (so the VO stays in sync with the hook/shots); this module enforces
// the contract described in the spec — if not needed, a music/visual/CTA
// suggestion must be present instead of a script.

import type { VoiceOverPlan } from "@/lib/types";

export function finalizeVoiceOver(raw: VoiceOverPlan): VoiceOverPlan {
  if (raw.needed) {
    return {
      ...raw,
      script: raw.script?.trim() || "(no script provided by the director)",
      musicSuggestion: raw.musicSuggestion?.trim() || null,
    };
  }
  return {
    ...raw,
    script: null,
    tone: null,
    musicSuggestion: raw.musicSuggestion?.trim() || "Upbeat trending TikTok track, cut to the beat.",
  };
}
