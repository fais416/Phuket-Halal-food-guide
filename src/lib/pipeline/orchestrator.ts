// orchestrator: wires every module together end to end
//   URL -> PRODUCT PAGE -> PRODUCT IMAGE -> AI VISION -> PRODUCT REFERENCE
//   -> AUTO DIRECTOR -> QUALITY CONTROL -> FLOW PROMPTS
// as an async generator of StreamEvents, so the UI's processing steps
// reflect real work actually happening on the server, not a fake timer.

import { fetchProductPage, ProductFetchError } from "@/lib/pipeline/productFetcher";
import { parseProductPage, hasUsableProductData } from "@/lib/pipeline/productParser";
import { extractCandidateImages } from "@/lib/pipeline/imageExtractor";
import { validateCandidateImages, normalizeUploadedImage } from "@/lib/pipeline/imageValidator";
import { analyzeProductImage, VisionAnalysisError } from "@/lib/pipeline/productVisionAnalyzer";
import { buildProductReferenceProfile } from "@/lib/pipeline/productReferenceBuilder";
import { generateStoryboard } from "@/lib/pipeline/storyboardGenerator";
import { runQualityControl } from "@/lib/pipeline/qualityController";
import { AiNotConfiguredError, isAiConfigured } from "@/lib/ai/client";
import type {
  DebugTrace,
  DurationOption,
  ErrorCode,
  PrimaryImage,
  ProductPageData,
  StreamEvent,
  ValidatedImage,
} from "@/lib/types";

export interface PipelineInput {
  url: string | null;
  uploadedImage: { base64: string; contentType: string } | null;
  duration: DurationOption;
}

function newTrace(): DebugTrace {
  return {
    urlAccessible: null,
    productPageFetched: null,
    productDataFound: null,
    imagesFound: 0,
    candidateImages: 0,
    accessibleImages: 0,
    visionAnalysisAttempted: false,
    visionAnalysisSuccess: null,
    failureReason: null,
    log: [],
  };
}

function log(trace: DebugTrace, line: string) {
  trace.log.push(line);
}

function errorCodeFromFetch(code: ProductFetchError["code"]): ErrorCode {
  switch (code) {
    case "INVALID_URL":
      return "INVALID_URL";
    case "SSRF_BLOCKED":
      return "SSRF_BLOCKED";
    case "TIMEOUT":
      return "TIMEOUT";
    case "REQUIRES_AUTH":
      return "REQUIRES_AUTH";
    case "BOT_BLOCKED":
      return "BOT_BLOCKED";
    default:
      return "PAGE_UNREACHABLE";
  }
}

export async function* runPipeline(input: PipelineInput): AsyncGenerator<StreamEvent, void, unknown> {
  const trace = newTrace();
  const debugEnabled = process.env.DEBUG_MODE === "true";

  const emitDebug = () => (debugEnabled ? trace : null);

  if (!input.url && !input.uploadedImage) {
    yield {
      type: "error",
      error: { code: "NO_INPUT", message: "Please paste a product URL or upload an image.", suggestFallbackUpload: true },
      debug: emitDebug(),
    };
    return;
  }

  if (!isAiConfigured()) {
    yield {
      type: "error",
      error: {
        code: "AI_NOT_CONFIGURED",
        message:
          "AI_API_KEY is not configured on the server. Add a valid Anthropic API key to your environment (see .env.example) and restart the app.",
        suggestFallbackUpload: false,
      },
      debug: emitDebug(),
    };
    return;
  }

  let productPage: ProductPageData | null = null;
  let html: string | null = null;
  let finalUrl: string | null = input.url;

  if (input.url) {
    yield { type: "progress", step: "fetch", message: "🔗 Reading product page..." };
    try {
      const fetched = await fetchProductPage(input.url);
      html = fetched.html;
      finalUrl = fetched.finalUrl;
      trace.urlAccessible = true;
      trace.productPageFetched = true;
      log(trace, `Fetched ${fetched.finalUrl} (HTTP ${fetched.status})`);
    } catch (err) {
      trace.urlAccessible = false;
      trace.productPageFetched = false;
      const fetchErr = err instanceof ProductFetchError ? err : null;
      const message = fetchErr?.message ?? "The product page could not be read.";
      trace.failureReason = message;
      log(trace, `Fetch failed: ${message}`);

      if (!input.uploadedImage) {
        yield {
          type: "error",
          error: {
            code: fetchErr ? errorCodeFromFetch(fetchErr.code) : "PAGE_UNREACHABLE",
            message,
            suggestFallbackUpload: true,
          },
          debug: emitDebug(),
        };
        return;
      }
      log(trace, "Continuing with user-uploaded image only (URL fetch failed).");
    }
  }

  if (html && finalUrl) {
    yield { type: "progress", step: "extract", message: "📦 Extracting product data..." };
    productPage = parseProductPage(html, finalUrl);
    trace.productDataFound = hasUsableProductData(productPage);
    log(trace, `Product data found: ${trace.productDataFound}`);
  }

  let primaryImage: PrimaryImage = null;
  let secondaryImages: ValidatedImage[] = [];

  if (html && finalUrl) {
    yield { type: "progress", step: "images", message: "🖼️ Finding product images..." };
    const candidates = extractCandidateImages(html, finalUrl);
    trace.imagesFound = candidates.length;
    trace.candidateImages = candidates.length;
    log(trace, `Found ${candidates.length} candidate image(s) on the page.`);

    yield { type: "progress", step: "validate-images", message: "🔍 Validating images..." };
    const { validated, attempts } = await validateCandidateImages(candidates, 3);
    trace.accessibleImages = validated.length;
    for (const a of attempts) log(trace, `Image ${a.ok ? "OK" : "REJECTED"} (${a.reason}): ${a.url}`);

    if (validated.length > 0) {
      primaryImage = validated[0]!;
      secondaryImages = validated.slice(1);
    } else if (!input.uploadedImage) {
      const reason =
        candidates.length === 0
          ? "Product page was accessible, but no usable product image was found on it."
          : "Product images were found on the page, but the image server blocked access or the files were invalid/too small.";
      trace.failureReason = reason;
      yield {
        type: "error",
        error: { code: "NO_IMAGE_FOUND", message: reason, suggestFallbackUpload: true },
        debug: emitDebug(),
      };
      return;
    }
  }

  if (!primaryImage && input.uploadedImage) {
    const normalized = normalizeUploadedImage(input.uploadedImage.base64, input.uploadedImage.contentType);
    if (!normalized.ok) {
      yield {
        type: "error",
        error: { code: "NO_IMAGE_FOUND", message: normalized.reason, suggestFallbackUpload: true },
        debug: emitDebug(),
      };
      return;
    }
    primaryImage = { uploaded: true, base64: normalized.base64, contentType: normalized.contentType };
    log(trace, "Using user-uploaded image as the product reference.");
  }

  if (!primaryImage) {
    yield {
      type: "error",
      error: {
        code: "NO_IMAGE_FOUND",
        message: "No product image is available to analyze. Please upload a product photo.",
        suggestFallbackUpload: true,
      },
      debug: emitDebug(),
    };
    return;
  }

  let vision = null;
  if (primaryImage) {
    yield { type: "progress", step: "vision", message: "👁️ AI Vision analyzing product..." };
    trace.visionAnalysisAttempted = true;
    try {
      vision = await analyzeProductImage(primaryImage.base64, primaryImage.contentType);
      trace.visionAnalysisSuccess = true;
      log(trace, `Vision analysis succeeded (confidence ${vision.confidence}).`);
    } catch (err) {
      if (err instanceof AiNotConfiguredError) {
        yield {
          type: "error",
          error: { code: "AI_NOT_CONFIGURED", message: err.message, suggestFallbackUpload: false },
          debug: emitDebug(),
        };
        return;
      }
      trace.visionAnalysisSuccess = false;
      const message = err instanceof VisionAnalysisError ? err.message : "The AI Vision model could not process the image.";
      trace.failureReason = message;
      log(trace, `Vision analysis failed: ${message}`);

      if (!productPage || !trace.productDataFound) {
        yield {
          type: "error",
          error: { code: "VISION_FAILED", message, suggestFallbackUpload: !input.uploadedImage },
          debug: emitDebug(),
        };
        return;
      }
      log(trace, "Continuing using verified page data only (visual data marked UNKNOWN).");
    }
  }

  const profile = buildProductReferenceProfile({ productPage, vision, primaryImage, secondaryImages });

  yield { type: "progress", step: "audience", message: "🎯 Selecting target audience..." };
  yield { type: "progress", step: "direct", message: "🎬 Directing advertisement..." };

  let direction;
  try {
    direction = await generateStoryboard(profile, input.duration);
  } catch (err) {
    if (err instanceof AiNotConfiguredError) {
      yield {
        type: "error",
        error: { code: "AI_NOT_CONFIGURED", message: err.message, suggestFallbackUpload: false },
        debug: emitDebug(),
      };
      return;
    }
    const message = err instanceof Error ? err.message : "The AI director failed to generate a creative direction.";
    log(trace, `Director failed: ${message}`);
    yield {
      type: "error",
      error: { code: "AI_CALL_FAILED", message, suggestFallbackUpload: false },
      debug: emitDebug(),
    };
    return;
  }

  yield { type: "progress", step: "shots", message: "🎥 Creating shots..." };
  yield { type: "progress", step: "prompts", message: "🤖 Creating Flow prompts..." };
  const finalDirection = runQualityControl(direction, profile);

  yield { type: "progress", step: "voiceover", message: "🎙️ Creating voice-over..." };
  yield { type: "progress", step: "cta", message: "🛒 Creating CTA..." };
  yield { type: "progress", step: "ready", message: "✅ Ready" };

  yield {
    type: "result",
    data: {
      productReference: profile,
      productPage,
      direction: finalDirection,
      debug: emitDebug(),
    },
  };
}
