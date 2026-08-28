// imageValidator: downloads and verifies candidate images before anything
// is sent to AI Vision. Walks the ranked candidate list and keeps trying
// until it has enough validated images (or runs out of candidates).

import { imageSize } from "image-size";
import { safeFetch, MAX_IMAGE_BYTES, SsrfBlockedError, FetchTimeoutError, NetworkError, ResponseTooLargeError } from "@/lib/security/ssrfGuard";
import type { CandidateImage, ValidatedImage } from "@/lib/types";

const ALLOWED_MIME = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const MIN_DIMENSION = 200;
const MIN_BYTES = 1024;

export interface ValidationAttempt {
  url: string;
  ok: boolean;
  reason: string;
}

export interface ValidationRun {
  validated: ValidatedImage[];
  attempts: ValidationAttempt[];
}

export async function validateCandidateImages(
  candidates: CandidateImage[],
  desiredCount = 3,
  maxAttempts = 8
): Promise<ValidationRun> {
  const validated: ValidatedImage[] = [];
  const attempts: ValidationAttempt[] = [];

  for (const candidate of candidates.slice(0, maxAttempts)) {
    if (validated.length >= desiredCount) break;
    try {
      const res = await safeFetch(candidate.url, { maxBytes: MAX_IMAGE_BYTES, method: "GET" });

      if (res.status >= 400) {
        attempts.push({ url: candidate.url, ok: false, reason: `HTTP ${res.status}` });
        continue;
      }
      const contentType = (res.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase();
      if (!contentType || !ALLOWED_MIME.has(contentType)) {
        attempts.push({ url: candidate.url, ok: false, reason: `Unsupported content-type: ${contentType || "unknown"}` });
        continue;
      }
      if (res.body.length < MIN_BYTES) {
        attempts.push({ url: candidate.url, ok: false, reason: "File too small to be a real product photo" });
        continue;
      }

      let width: number | undefined;
      let height: number | undefined;
      try {
        const dim = imageSize(res.body);
        width = dim.width;
        height = dim.height;
      } catch {
        attempts.push({ url: candidate.url, ok: false, reason: "Could not read image dimensions (corrupt or unsupported encoding)" });
        continue;
      }
      if (width && height && (width < MIN_DIMENSION || height < MIN_DIMENSION)) {
        attempts.push({ url: candidate.url, ok: false, reason: `Image too small (${width}x${height})` });
        continue;
      }

      validated.push({
        ...candidate,
        width: width ?? candidate.width,
        height: height ?? candidate.height,
        contentType,
        byteSize: res.body.length,
        base64: res.body.toString("base64"),
      });
      attempts.push({ url: candidate.url, ok: true, reason: "validated" });
    } catch (err) {
      if (err instanceof SsrfBlockedError) {
        attempts.push({ url: candidate.url, ok: false, reason: "Blocked: image host resolves to a private/internal address" });
      } else if (err instanceof FetchTimeoutError) {
        attempts.push({ url: candidate.url, ok: false, reason: "Timed out while downloading image" });
      } else if (err instanceof ResponseTooLargeError) {
        attempts.push({ url: candidate.url, ok: false, reason: "Image file exceeded the size limit" });
      } else if (err instanceof NetworkError) {
        attempts.push({ url: candidate.url, ok: false, reason: `Network error: ${err.message}` });
      } else {
        attempts.push({ url: candidate.url, ok: false, reason: "Unknown error while validating image" });
      }
    }
  }

  return { validated, attempts };
}

export function normalizeUploadedImage(base64: string, contentType: string): { ok: true; base64: string; contentType: string } | { ok: false; reason: string } {
  const mime = contentType.toLowerCase();
  if (!ALLOWED_MIME.has(mime)) {
    return { ok: false, reason: `Unsupported image type: ${contentType}. Please upload JPEG, PNG, or WEBP.` };
  }
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length < MIN_BYTES) {
    return { ok: false, reason: "The uploaded image file is too small or empty." };
  }
  if (bytes.length > MAX_IMAGE_BYTES) {
    return { ok: false, reason: "The uploaded image file is too large (max 8MB)." };
  }
  try {
    imageSize(bytes);
  } catch {
    return { ok: false, reason: "The uploaded file could not be read as a valid image." };
  }
  return { ok: true, base64, contentType: mime };
}
