// qualityController: rule-based QC pass over every shot before anything is
// shown to the user. Checks product-consistency phrasing, 9:16/duration
// formatting, and unsupported claims — and auto-fixes what it can (strip
// claim language, rebuild the prompt from the deterministic template)
// rather than just flagging problems.

import type { AdDirection, AdDirectionResult, ProductReferenceProfile, Shot, ShotWithPrompt } from "@/lib/types";
import { buildFlowPrompt, PRODUCT_CONSISTENCY_BLOCK } from "@/lib/pipeline/flowPromptGenerator";
import { checkForUnsupportedClaims, stripUnsupportedClaims } from "@/lib/pipeline/claimGuard";
import { finalizeVoiceOver } from "@/lib/pipeline/voiceOverGenerator";
import { finalizeCta } from "@/lib/pipeline/ctaGenerator";
import { finalizeCaptions } from "@/lib/pipeline/captionGenerator";

function qcShot(shot: Shot, profile: ProductReferenceProfile): ShotWithPrompt {
  const issues: string[] = [];
  let autoFixed = false;

  let clean = { ...shot };

  for (const field of ["visual", "action", "purpose", "mood"] as const) {
    const check = checkForUnsupportedClaims(clean[field]);
    if (!check.clean) {
      issues.push(`Unsupported claim language in ${field}: ${check.flagged.join(", ")}`);
      clean = { ...clean, [field]: stripUnsupportedClaims(clean[field]).text };
      autoFixed = true;
    }
  }
  if (clean.onScreenText) {
    const check = checkForUnsupportedClaims(clean.onScreenText);
    if (!check.clean) {
      issues.push(`Unsupported claim language in on-screen text: ${check.flagged.join(", ")}`);
      clean.onScreenText = stripUnsupportedClaims(clean.onScreenText).text;
      autoFixed = true;
    }
  }
  if (clean.voiceOverLine) {
    const check = checkForUnsupportedClaims(clean.voiceOverLine);
    if (!check.clean) {
      issues.push(`Unsupported claim language in voice-over line: ${check.flagged.join(", ")}`);
      clean.voiceOverLine = stripUnsupportedClaims(clean.voiceOverLine).text;
      autoFixed = true;
    }
  }
  if (clean.timeEnd <= clean.timeStart) {
    issues.push("Shot had zero or negative duration.");
    clean.timeEnd = clean.timeStart + 1.5;
    autoFixed = true;
  }
  if (!clean.transition?.trim()) {
    issues.push("Missing transition.");
    clean.transition = "hard cut";
    autoFixed = true;
  }

  const flowPrompt = buildFlowPrompt(clean, profile);
  const promptOk =
    flowPrompt.includes("9:16") &&
    flowPrompt.includes(PRODUCT_CONSISTENCY_BLOCK) &&
    flowPrompt.includes("NEGATIVE INSTRUCTIONS");
  if (!promptOk) {
    // Should be unreachable given the deterministic template, but fail loud
    // rather than silently shipping a non-compliant prompt.
    issues.push("Generated prompt was missing required consistency/format clauses.");
  }

  return {
    ...clean,
    flowPrompt,
    qc: { passed: issues.length === 0 || promptOk, issues, autoFixed },
  };
}

export function runQualityControl(direction: AdDirection, profile: ProductReferenceProfile): AdDirectionResult {
  const shots = direction.shots
    .slice()
    .sort((a, b) => a.timeStart - b.timeStart)
    .map((s) => qcShot(s, profile));

  const totalIssuesFound = shots.reduce((sum, s) => sum + s.qc.issues.length, 0);
  const totalAutoFixed = shots.filter((s) => s.qc.autoFixed).length;

  return {
    targetAudience: direction.targetAudience,
    mainStrategy: direction.mainStrategy,
    alternativeStrategies: direction.alternativeStrategies,
    hook: direction.hook,
    shots,
    voiceOver: finalizeVoiceOver(direction.voiceOver),
    cta: finalizeCta(direction.cta),
    captions: finalizeCaptions(direction.captions),
    qcSummary: { totalIssuesFound, totalAutoFixed },
  };
}
