import type { CtaPlan } from "@/lib/types";
import { stripUnsupportedClaims } from "@/lib/pipeline/claimGuard";

export function finalizeCta(raw: CtaPlan): CtaPlan {
  const { text, changed } = stripUnsupportedClaims(raw.text);
  return {
    text: text || "สนใจดูรายละเอียดเพิ่มเติม กดตะกร้าได้เลยค่ะ",
    reason: changed ? `${raw.reason} (unsupported claim language removed)` : raw.reason,
  };
}
