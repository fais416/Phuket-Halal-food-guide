// claimGuard: shared "no unsupported claims" check used by ctaGenerator,
// captionGenerator, and qualityController (section 25/23 of the spec:
// AI must not exaggerate or invent claims about the product).

const UNSUPPORTED_CLAIM_PATTERNS: RegExp[] = [
  /ดีที่สุดในโลก/i,
  /ดีที่สุด/i,
  /อันดับ ?1/i,
  /รับประกัน 100%/i,
  /การันตี 100%/i,
  /ไม่มีที่ติ/i,
  /best in the world/i,
  /guaranteed/i,
  /number ?1/i,
  /#1\b/,
  /\b100% (?:effective|safe|guaranteed)\b/i,
  /cures?/i,
  /รักษาโรค/i,
];

export interface ClaimCheckResult {
  text: string;
  flagged: string[];
  clean: boolean;
}

export function checkForUnsupportedClaims(text: string): ClaimCheckResult {
  const flagged: string[] = [];
  for (const pattern of UNSUPPORTED_CLAIM_PATTERNS) {
    const match = text.match(pattern);
    if (match) flagged.push(match[0]);
  }
  return { text, flagged, clean: flagged.length === 0 };
}

/** Removes flagged phrases outright, used as the auto-fix step in qualityController. */
export function stripUnsupportedClaims(text: string): { text: string; changed: boolean } {
  let result = text;
  let changed = false;
  for (const pattern of UNSUPPORTED_CLAIM_PATTERNS) {
    if (pattern.test(result)) {
      result = result.replace(pattern, "").replace(/\s{2,}/g, " ").trim();
      changed = true;
    }
  }
  return { text: result, changed };
}
