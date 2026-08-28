"use client";

import { useState } from "react";
import type { DurationOption, PipelineError, ResultEvent, StreamEvent } from "@/lib/types";
import ImageUpload, { type UploadedImageValue } from "@/components/ImageUpload";
import ProcessingStatus from "@/components/ProcessingStatus";
import ResultsView from "@/components/ResultsView";

type Phase = "idle" | "processing" | "error" | "result";

export default function Home() {
  const [url, setUrl] = useState("");
  const [duration, setDuration] = useState<DurationOption>("auto");
  const [uploadedImage, setUploadedImage] = useState<UploadedImageValue | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<PipelineError | null>(null);
  const [result, setResult] = useState<ResultEvent["data"] | null>(null);

  async function runDirector() {
    if (!url.trim() && !uploadedImage) {
      setError({ code: "NO_INPUT", message: "Please paste a product URL or upload an image.", suggestFallbackUpload: true });
      setPhase("error");
      return;
    }

    setPhase("processing");
    setLog([]);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/direct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim() || undefined,
          uploadedImage: uploadedImage ? { base64: uploadedImage.base64, contentType: uploadedImage.contentType } : undefined,
          duration,
        }),
      });

      if (!res.body) throw new Error("No response stream from server.");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event: StreamEvent = JSON.parse(line);
          if (event.type === "progress") {
            setLog((prev) => [...prev, event.message]);
          } else if (event.type === "result") {
            setResult(event.data);
            setPhase("result");
          } else if (event.type === "error") {
            setError(event.error);
            setPhase("error");
          }
        }
      }
    } catch (err) {
      setError({
        code: "AI_CALL_FAILED",
        message: err instanceof Error ? err.message : "An unexpected error occurred.",
        suggestFallbackUpload: false,
      });
      setPhase("error");
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-12 sm:py-20">
      <header className="mb-10 text-center">
        <h1 className="bg-gradient-to-r from-accent to-accent2 bg-clip-text text-3xl font-extrabold text-transparent sm:text-4xl">
          AI TikTok Shop Auto Director
        </h1>
        <p className="mt-3 text-sm text-white/50 sm:text-base">
          Turn any accessible product link into a complete AI video advertisement.
        </p>
      </header>

      {phase !== "result" && (
        <div className="card space-y-5 p-6 sm:p-8">
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-white/50">🔗 Product URL</label>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Paste your product link here..."
              className="w-full rounded-xl border border-border bg-panel2 px-4 py-3 text-sm text-white placeholder:text-white/30 focus:border-accent focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-white/50">Duration</label>
            <div className="flex gap-2">
              {(["auto", "15", "30"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDuration(d)}
                  className={`rounded-lg border px-4 py-2 text-xs font-semibold transition ${
                    duration === d ? "border-accent bg-accent/15 text-white" : "border-border bg-panel2 text-white/50 hover:text-white"
                  }`}
                >
                  {d === "auto" ? "Auto" : `${d}s`}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={runDirector}
            disabled={phase === "processing"}
            className="btn-primary w-full rounded-xl py-4 text-sm font-bold text-white shadow-lg shadow-accent/20 transition disabled:opacity-50"
          >
            {phase === "processing" ? "DIRECTING…" : "🎬 DIRECT MY PRODUCT"}
          </button>

          <div className="border-t border-border pt-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/50">Optional Product Image</p>
            <p className="mb-3 text-xs text-white/40">
              Only upload an image if the product page cannot provide a usable product image.
            </p>
            <ImageUpload value={uploadedImage} onChange={setUploadedImage} />
          </div>
        </div>
      )}

      {phase === "processing" && (
        <div className="mt-6">
          <ProcessingStatus log={log} />
        </div>
      )}

      {phase === "error" && error && (
        <div className="mt-6 card space-y-4 border-bad/30 p-6">
          <p className="text-sm font-semibold text-bad">Could not complete this request</p>
          <p className="text-sm text-white/70">{error.message}</p>
          {error.suggestFallbackUpload && (
            <div className="border-t border-border pt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/50">Upload Product Image</p>
              <ImageUpload value={uploadedImage} onChange={setUploadedImage} />
              <button
                onClick={runDirector}
                className="btn-primary mt-4 w-full rounded-xl py-3 text-sm font-bold text-white"
              >
                🎬 TRY AGAIN
              </button>
            </div>
          )}
        </div>
      )}

      {phase === "result" && result && (
        <div className="mt-2">
          <button
            onClick={() => {
              setPhase("idle");
              setResult(null);
            }}
            className="mb-4 text-xs font-semibold text-white/40 hover:text-white"
          >
            ← Start a new product
          </button>
          <ResultsView productPage={result.productPage} productReference={result.productReference} direction={result.direction} />
        </div>
      )}
    </main>
  );
}
