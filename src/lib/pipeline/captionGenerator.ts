import type { CaptionSet } from "@/lib/types";
import { stripUnsupportedClaims } from "@/lib/pipeline/claimGuard";

function finalizeVariant(v: { text: string; hashtags: string[] }) {
  const { text } = stripUnsupportedClaims(v.text);
  const hashtags = v.hashtags
    .map((h) => (h.startsWith("#") ? h : `#${h}`))
    .filter((h) => h.length > 1)
    .slice(0, 8);
  return { text, hashtags };
}

export function finalizeCaptions(raw: CaptionSet): CaptionSet {
  return {
    viral: finalizeVariant(raw.viral),
    productFocus: finalizeVariant(raw.productFocus),
    softSell: finalizeVariant(raw.softSell),
  };
}
