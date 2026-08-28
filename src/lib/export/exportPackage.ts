import JSZip from "jszip";
import type { AdDirectionResult, ProductPageData, ProductReferenceProfile } from "@/lib/types";

function confidenceLine(label: string, value: unknown, confidence: string): string {
  return `${label}: ${value ?? "UNKNOWN"} [${confidence}]`;
}

export function buildExportFiles(params: {
  productPage: ProductPageData | null;
  productReference: ProductReferenceProfile;
  direction: AdDirectionResult;
}): Record<string, string> {
  const { productPage, productReference, direction } = params;
  const files: Record<string, string> = {};

  files["01_PRODUCT_DATA.txt"] = productPage
    ? [
        confidenceLine("Name", productPage.name.value, productPage.name.confidence),
        confidenceLine("Brand", productPage.brand.value, productPage.brand.confidence),
        confidenceLine("Description", productPage.description.value, productPage.description.confidence),
        confidenceLine("Price", productPage.price.value, productPage.price.confidence),
        confidenceLine("Currency", productPage.currency.value, productPage.currency.confidence),
        confidenceLine("Availability", productPage.availability.value, productPage.availability.confidence),
        confidenceLine("SKU", productPage.sku.value, productPage.sku.confidence),
        `URL: ${productPage.url}`,
      ].join("\n")
    : "No product page data (image-only run).";

  files["02_PRODUCT_ANALYSIS.txt"] = productReference.visual
    ? [
        `Category: ${productReference.visual.product_category ?? "unknown"}`,
        `Colors: ${productReference.visual.colors.join(", ") || "unknown"}`,
        `Shape: ${productReference.visual.shape ?? "unknown"}`,
        `Material (visible): ${productReference.visual.visible_material ?? "unknown"}`,
        `Logo: ${productReference.visual.logo ?? "unknown"}`,
        `Branding: ${productReference.visual.branding ?? "unknown"}`,
        `Visible details: ${productReference.visual.visible_details.join(", ") || "unknown"}`,
        `Visual style: ${productReference.visual.visual_style ?? "unknown"}`,
        `Possible use cases (AI observation): ${productReference.visual.possible_use_cases.join(", ") || "unknown"}`,
        `Vision confidence: ${productReference.visual.confidence}`,
      ].join("\n")
    : "No AI Vision analysis available.";

  files["03_PRODUCT_REFERENCE.txt"] = [
    confidenceLine("Product name", productReference.productName.value, productReference.productName.confidence),
    confidenceLine("Brand", productReference.brand.value, productReference.brand.confidence),
    confidenceLine("Colors", productReference.colors.value?.join(", "), productReference.colors.confidence),
    confidenceLine("Shape", productReference.shape.value, productReference.shape.confidence),
    confidenceLine("Visual style", productReference.visualStyle.value, productReference.visualStyle.confidence),
    confidenceLine("Visible details", productReference.visibleDetails.value?.join(", "), productReference.visibleDetails.confidence),
    `Primary image source: ${productReference.primaryImage && "uploaded" in productReference.primaryImage ? "user upload" : productReference.primaryImage?.url ?? "none"}`,
  ].join("\n");

  files["04_AD_STRATEGY.txt"] = [
    `TARGET AUDIENCE: ${direction.targetAudience}`,
    ``,
    `MAIN STRATEGY: ${direction.mainStrategy.strategy}`,
    `WHY THIS STRATEGY FITS: ${direction.mainStrategy.whyItFits}`,
    ``,
    `ALTERNATIVE STRATEGIES:`,
    ...direction.alternativeStrategies.map((s, i) => `${i + 1}. ${s.strategy} — ${s.whyItFits}`),
  ].join("\n");

  files["05_HOOK.txt"] = [
    `TYPE: ${direction.hook.type}`,
    `DESCRIPTION: ${direction.hook.description}`,
    direction.hook.onScreenText ? `ON-SCREEN TEXT: ${direction.hook.onScreenText}` : null,
    direction.hook.spokenLine ? `SPOKEN LINE: ${direction.hook.spokenLine}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  files["06_STORYBOARD.txt"] = direction.shots
    .map(
      (s) =>
        `SHOT ${s.index} (${s.timeStart.toFixed(1)}s–${s.timeEnd.toFixed(1)}s)\nPurpose: ${s.purpose}\nVisual: ${s.visual}\nAction: ${s.action}\nCamera: ${s.camera.shot} / ${s.camera.movement}\nLighting: ${s.lighting.type}\nEnvironment: ${s.environment.setting}\nTransition: ${s.transition}`
    )
    .join("\n\n");

  direction.shots.forEach((s, i) => {
    files[`0${7 + i}_SHOT_${String(s.index).padStart(2, "0")}.txt`] = s.flowPrompt;
  });

  files["12_VOICE_OVER.txt"] = direction.voiceOver.needed
    ? `TONE: ${direction.voiceOver.tone}\nSCRIPT:\n${direction.voiceOver.script}`
    : `Voice-over not needed.\nReason: ${direction.voiceOver.reason}\nMusic suggestion: ${direction.voiceOver.musicSuggestion}`;

  files["13_CTA.txt"] = `${direction.cta.text}\n\nReason: ${direction.cta.reason}`;

  files["14_CAPTION.txt"] = [
    `VIRAL:\n${direction.captions.viral.text}\n${direction.captions.viral.hashtags.join(" ")}`,
    `PRODUCT FOCUS:\n${direction.captions.productFocus.text}\n${direction.captions.productFocus.hashtags.join(" ")}`,
    `SOFT SELL:\n${direction.captions.softSell.text}\n${direction.captions.softSell.hashtags.join(" ")}`,
  ].join("\n\n");

  return files;
}

export async function downloadPromptPackage(files: Record<string, string>, zipName: string) {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) {
    zip.file(name, content);
  }
  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = zipName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadTextFile(content: string, fileName: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function allPromptsText(direction: AdDirectionResult): string {
  return direction.shots.map((s) => `=== SHOT ${s.index} ===\n${s.flowPrompt}`).join("\n\n");
}
