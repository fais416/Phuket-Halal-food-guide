"use client";

import { useRef, useState } from "react";

export interface UploadedImageValue {
  base64: string;
  contentType: string;
  previewUrl: string;
  fileName: string;
}

const ACCEPTED = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

export default function ImageUpload({
  value,
  onChange,
}: {
  value: UploadedImageValue | null;
  onChange: (value: UploadedImageValue | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  function handleFile(file: File) {
    setError(null);
    if (!ACCEPTED.includes(file.type)) {
      setError("Please upload a JPEG, PNG, or WEBP image.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError("Image must be smaller than 8MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(",")[1] ?? "";
      onChange({ base64, contentType: file.type, previewUrl: dataUrl, fileName: file.name });
    };
    reader.readAsDataURL(file);
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED.join(",")}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
      {value ? (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-panel2 p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value.previewUrl} alt="Uploaded product" className="h-16 w-16 rounded-lg object-cover" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-white/80">{value.fileName}</p>
            <button
              type="button"
              onClick={() => onChange(null)}
              className="mt-1 text-xs font-medium text-white/40 hover:text-bad"
            >
              Remove image
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="w-full rounded-xl border border-dashed border-border bg-panel2 px-4 py-3 text-sm font-medium text-white/70 transition hover:border-accent hover:text-white"
        >
          Upload Image
        </button>
      )}
      {error && <p className="mt-2 text-xs text-bad">{error}</p>}
    </div>
  );
}
