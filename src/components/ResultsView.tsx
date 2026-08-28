"use client";

import type { AdDirectionResult, ProductPageData, ProductReferenceProfile } from "@/lib/types";
import CopyButton from "@/components/CopyButton";
import { allPromptsText, buildExportFiles, downloadPromptPackage, downloadTextFile } from "@/lib/export/exportPackage";

function ConfidenceBadge({ confidence }: { confidence: string }) {
  const styles: Record<string, string> = {
    VERIFIED: "bg-good/15 text-good border-good/30",
    VISUAL: "bg-accent/15 text-accent border-accent/30",
    AI_INFERENCE: "bg-warn/15 text-warn border-warn/30",
    UNKNOWN: "bg-white/5 text-white/40 border-white/10",
  };
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide ${styles[confidence] ?? styles.UNKNOWN}`}>
      {confidence}
    </span>
  );
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="card p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-white/60">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export default function ResultsView({
  productPage,
  productReference,
  direction,
}: {
  productPage: ProductPageData | null;
  productReference: ProductReferenceProfile;
  direction: AdDirectionResult;
}) {
  const files = buildExportFiles({ productPage, productReference, direction });
  const primaryImageUrl =
    productReference.primaryImage && "uploaded" in productReference.primaryImage
      ? `data:${productReference.primaryImage.contentType};base64,${productReference.primaryImage.base64}`
      : productReference.primaryImage?.url;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-panel2 p-4">
        <div className="flex items-center gap-3">
          {primaryImageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={primaryImageUrl} alt="Product reference" className="h-14 w-14 rounded-xl object-cover" />
          )}
          <div>
            <p className="text-sm font-semibold text-white">{productReference.productName.value ?? "Product"}</p>
            <p className="text-xs text-white/40">
              QC: {direction.qcSummary.totalIssuesFound} issue(s) found · {direction.qcSummary.totalAutoFixed} auto-fixed
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => downloadPromptPackage(files, "ai-tiktok-shop-prompt-package.zip")}
            className="btn-primary rounded-lg px-4 py-2 text-xs font-bold text-white"
          >
            DOWNLOAD PROMPT PACKAGE
          </button>
          <CopyButton text={allPromptsText(direction)} label="COPY ALL PROMPTS" />
          <button
            onClick={() => downloadTextFile(files["06_STORYBOARD.txt"] ?? "", "storyboard.txt")}
            className="rounded-lg border border-border bg-panel2 px-3 py-1.5 text-xs font-semibold text-white/80 hover:border-accent hover:text-white"
          >
            EXPORT STORYBOARD
          </button>
        </div>
      </div>

      <Section title="Product Analysis">
        <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-white/50">Name</span>
            <span className="flex items-center gap-2 text-right text-white">
              {productReference.productName.value ?? "Unknown"} <ConfidenceBadge confidence={productReference.productName.confidence} />
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-white/50">Brand</span>
            <span className="flex items-center gap-2 text-right text-white">
              {productReference.brand.value ?? "Unknown"} <ConfidenceBadge confidence={productReference.brand.confidence} />
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-white/50">Colors</span>
            <span className="flex items-center gap-2 text-right text-white">
              {productReference.colors.value?.join(", ") ?? "Unknown"} <ConfidenceBadge confidence={productReference.colors.confidence} />
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-white/50">Shape</span>
            <span className="flex items-center gap-2 text-right text-white">
              {productReference.shape.value ?? "Unknown"} <ConfidenceBadge confidence={productReference.shape.confidence} />
            </span>
          </div>
          {productPage && (
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-white/50">Price</span>
              <span className="flex items-center gap-2 text-right text-white">
                {productPage.price.value ?? "Unknown"} {productPage.currency.value ?? ""} <ConfidenceBadge confidence={productPage.price.confidence} />
              </span>
            </div>
          )}
        </div>
      </Section>

      <Section title="Ad Strategy">
        <p className="text-sm font-semibold text-white">{direction.mainStrategy.strategy}</p>
        <p className="mt-1 text-sm text-white/60">{direction.mainStrategy.whyItFits}</p>
        <p className="mt-4 text-sm text-white/50">Target audience: <span className="text-white/80">{direction.targetAudience}</span></p>
        <div className="mt-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-white/40">Alternative strategies</p>
          {direction.alternativeStrategies.map((s, i) => (
            <div key={i} className="rounded-lg border border-border bg-panel2 p-3 text-sm">
              <span className="font-semibold text-white">{s.strategy}</span>
              <span className="text-white/50"> — {s.whyItFits}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Hook (0–3s)">
        <p className="text-sm font-semibold text-white">{direction.hook.type}</p>
        <p className="mt-1 text-sm text-white/60">{direction.hook.description}</p>
        {direction.hook.onScreenText && <p className="mt-2 text-sm text-white/80">Text: &ldquo;{direction.hook.onScreenText}&rdquo;</p>}
        {direction.hook.spokenLine && <p className="mt-1 text-sm text-white/80">Spoken: &ldquo;{direction.hook.spokenLine}&rdquo;</p>}
      </Section>

      <Section title="Storyboard & Flow Prompts">
        <div className="space-y-4">
          {direction.shots.map((shot) => (
            <div key={shot.index} className="rounded-xl border border-border bg-panel2 p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-bold text-white">
                  Shot {shot.index} · {shot.timeStart.toFixed(1)}s–{shot.timeEnd.toFixed(1)}s
                </p>
                <div className="flex items-center gap-2">
                  {shot.qc.autoFixed && <span className="text-[10px] font-semibold text-warn">QC AUTO-FIXED</span>}
                  <CopyButton text={shot.flowPrompt} label="COPY FLOW PROMPT" />
                </div>
              </div>
              <p className="text-sm text-white/70">{shot.visual}</p>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-white/40 sm:grid-cols-3">
                <span>Camera: {shot.camera.shot} / {shot.camera.movement}</span>
                <span>Lighting: {shot.lighting.type}</span>
                <span>Setting: {shot.environment.setting}</span>
              </div>
              <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-ink p-3 text-[11px] leading-relaxed text-white/60 scrollbar-thin">
                {shot.flowPrompt}
              </pre>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Voice-Over"
        action={<CopyButton text={direction.voiceOver.script ?? direction.voiceOver.musicSuggestion ?? ""} label="COPY VOICE OVER" />}
      >
        {direction.voiceOver.needed ? (
          <>
            <p className="text-sm text-white/50">Tone: {direction.voiceOver.tone}</p>
            <p className="mt-2 whitespace-pre-wrap text-sm text-white/80">{direction.voiceOver.script}</p>
          </>
        ) : (
          <>
            <p className="text-sm text-white/60">Voice-over not needed: {direction.voiceOver.reason}</p>
            <p className="mt-1 text-sm text-white/80">Music suggestion: {direction.voiceOver.musicSuggestion}</p>
          </>
        )}
      </Section>

      <Section title="CTA" action={<CopyButton text={direction.cta.text} label="COPY CTA" />}>
        <p className="text-sm text-white">{direction.cta.text}</p>
        <p className="mt-1 text-xs text-white/40">{direction.cta.reason}</p>
      </Section>

      <Section title="TikTok Caption">
        <div className="space-y-3">
          {(
            [
              ["Viral", direction.captions.viral],
              ["Product Focus", direction.captions.productFocus],
              ["Soft Sell", direction.captions.softSell],
            ] as const
          ).map(([label, cap]) => (
            <div key={label} className="rounded-lg border border-border bg-panel2 p-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-white/40">{label}</span>
                <CopyButton text={`${cap.text}\n${cap.hashtags.join(" ")}`} label="COPY CAPTION" />
              </div>
              <p className="text-sm text-white">{cap.text}</p>
              <p className="mt-1 text-xs text-accent">{cap.hashtags.join(" ")}</p>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
