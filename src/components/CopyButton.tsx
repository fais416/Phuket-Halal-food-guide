"use client";

import { useState } from "react";

export default function CopyButton({ text, label = "COPY" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can be blocked (permissions/insecure context) — fail silently, button just won't confirm.
    }
  }

  return (
    <button
      onClick={handleCopy}
      className="shrink-0 rounded-lg border border-border bg-panel2 px-3 py-1.5 text-xs font-semibold tracking-wide text-white/80 transition hover:border-accent hover:text-white active:scale-95"
      type="button"
    >
      {copied ? "✓ COPIED" : label}
    </button>
  );
}
