// Shared types for the AI TikTok Shop Auto Director pipeline.
//
// DataConfidence encodes where a piece of information came from, per the
// project rule that AI inference must never be silently upgraded to
// "verified": VERIFIED (from the product page itself), VISUAL (seen in the
// product photo by AI Vision), AI_INFERENCE (reasoned/guessed by the AI),
// UNKNOWN (could not be determined — never invented).
export type DataConfidence = "VERIFIED" | "VISUAL" | "AI_INFERENCE" | "UNKNOWN";

export interface ConfidenceField<T> {
  value: T | null;
  confidence: DataConfidence;
}

export function verified<T>(value: T | null | undefined): ConfidenceField<T> {
  return value === null || value === undefined || value === ""
    ? { value: null, confidence: "UNKNOWN" }
    : { value, confidence: "VERIFIED" };
}

export function unknownField<T>(): ConfidenceField<T> {
  return { value: null, confidence: "UNKNOWN" };
}

export interface ProductPageData {
  name: ConfidenceField<string>;
  brand: ConfidenceField<string>;
  description: ConfidenceField<string>;
  price: ConfidenceField<string>;
  currency: ConfidenceField<string>;
  availability: ConfidenceField<string>;
  sku: ConfidenceField<string>;
  variants: ConfidenceField<string[]>;
  specifications: ConfidenceField<Record<string, string>>;
  url: string;
  /** Which extraction layer supplied each field: json-ld / schema-org / og / meta / html */
  sourceSignals: Record<string, string>;
}

export interface CandidateImage {
  url: string;
  score: number;
  reasons: string[];
  width?: number;
  height?: number;
  alt?: string;
  source: string;
}

export interface ValidatedImage extends CandidateImage {
  contentType: string;
  byteSize: number;
  base64: string;
}

export interface UploadedImage {
  uploaded: true;
  base64: string;
  contentType: string;
}

export type PrimaryImage = ValidatedImage | UploadedImage | null;

export interface VisionAnalysis {
  product_category: string | null;
  product_name: string | null;
  colors: string[];
  shape: string | null;
  visible_material: string | null;
  logo: string | null;
  branding: string | null;
  visible_details: string[];
  visual_style: string | null;
  possible_use_cases: string[];
  confidence: number;
}

export interface ProductReferenceProfile {
  primaryImage: PrimaryImage;
  secondaryImages: ValidatedImage[];
  productName: ConfidenceField<string>;
  brand: ConfidenceField<string>;
  verified: ProductPageData | null;
  visual: VisionAnalysis | null;
  colors: ConfidenceField<string[]>;
  shape: ConfidenceField<string>;
  visualStyle: ConfidenceField<string>;
  visibleDetails: ConfidenceField<string[]>;
}

export type AdStrategyType =
  | "Viral TikTok"
  | "UGC"
  | "Product Showcase"
  | "Lifestyle"
  | "Premium Commercial"
  | "Product Review"
  | "Problem-Solution"
  | "Unboxing"
  | "Emotional";

export interface AdStrategy {
  strategy: AdStrategyType;
  whyItFits: string;
}

export interface HookPlan {
  type: "Visual Hook" | "Spoken Hook" | "Product Reveal" | "Camera Movement Hook" | "Text Hook";
  description: string;
  onScreenText: string | null;
  spokenLine: string | null;
}

export interface CameraPlan {
  shot:
    | "Macro"
    | "Close-up"
    | "Medium"
    | "Wide"
    | "Top-down"
    | "Low angle"
    | "Eye level";
  movement:
    | "Slow push-in"
    | "Orbit"
    | "Dolly"
    | "Tracking"
    | "Pan"
    | "Tilt"
    | "Crane"
    | "Rack focus"
    | "Static";
  lensLook: string;
}

export interface LightingPlan {
  type:
    | "Natural sunlight"
    | "Soft studio"
    | "Golden hour"
    | "Dramatic"
    | "High-key"
    | "Low-key"
    | "Luxury";
  direction: string;
  quality: string;
  intensity: string;
  mood: string;
}

export interface EnvironmentPlan {
  setting: string;
  reason: string;
}

export interface Shot {
  index: number;
  timeStart: number;
  timeEnd: number;
  purpose: string;
  visual: string;
  action: string;
  camera: CameraPlan;
  lighting: LightingPlan;
  environment: EnvironmentPlan;
  composition: string;
  depthOfField: string;
  focus: string;
  mood: string;
  transition: string;
  voiceOverLine: string | null;
  onScreenText: string | null;
}

export interface ShotWithPrompt extends Shot {
  flowPrompt: string;
  qc: {
    passed: boolean;
    issues: string[];
    autoFixed: boolean;
  };
}

export interface VoiceOverPlan {
  needed: boolean;
  tone:
    | "Friendly"
    | "Premium"
    | "Energetic"
    | "Natural"
    | "Confident"
    | "UGC"
    | null;
  script: string | null;
  musicSuggestion: string | null;
  reason: string;
}

export interface CtaPlan {
  text: string;
  reason: string;
}

export interface CaptionSet {
  viral: { text: string; hashtags: string[] };
  productFocus: { text: string; hashtags: string[] };
  softSell: { text: string; hashtags: string[] };
}

export interface AdDirection {
  targetAudience: string;
  mainStrategy: AdStrategy;
  alternativeStrategies: [AdStrategy, AdStrategy];
  hook: HookPlan;
  shots: Shot[];
  voiceOver: VoiceOverPlan;
  cta: CtaPlan;
  captions: CaptionSet;
}

export interface AdDirectionResult extends Omit<AdDirection, "shots"> {
  shots: ShotWithPrompt[];
  qcSummary: { totalIssuesFound: number; totalAutoFixed: number };
}

export type DurationOption = "auto" | "15" | "30";

export interface DebugTrace {
  urlAccessible: boolean | null;
  productPageFetched: boolean | null;
  productDataFound: boolean | null;
  imagesFound: number;
  candidateImages: number;
  accessibleImages: number;
  visionAnalysisAttempted: boolean;
  visionAnalysisSuccess: boolean | null;
  failureReason: string | null;
  log: string[];
}

export type ErrorCode =
  | "INVALID_URL"
  | "SSRF_BLOCKED"
  | "PAGE_UNREACHABLE"
  | "REQUIRES_AUTH"
  | "BOT_BLOCKED"
  | "TIMEOUT"
  | "NO_PRODUCT_DATA"
  | "NO_IMAGE_FOUND"
  | "IMAGE_BLOCKED"
  | "VISION_FAILED"
  | "AI_NOT_CONFIGURED"
  | "AI_CALL_FAILED"
  | "NO_INPUT";

export interface PipelineError {
  code: ErrorCode;
  message: string;
  suggestFallbackUpload: boolean;
}

export interface ProgressEvent {
  type: "progress";
  step: string;
  message: string;
}

export interface ResultEvent {
  type: "result";
  data: {
    productReference: ProductReferenceProfile;
    productPage: ProductPageData | null;
    direction: AdDirectionResult;
    debug: DebugTrace | null;
  };
}

export interface ErrorEvent {
  type: "error";
  error: PipelineError;
  debug: DebugTrace | null;
}

export type StreamEvent = ProgressEvent | ResultEvent | ErrorEvent;
