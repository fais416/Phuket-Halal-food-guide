import { NextRequest } from "next/server";
import { runPipeline } from "@/lib/pipeline/orchestrator";
import type { DurationOption } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface DirectRequestBody {
  url?: string;
  uploadedImage?: { base64: string; contentType: string } | null;
  duration?: DurationOption;
}

export async function POST(req: NextRequest) {
  let body: DirectRequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ type: "error", error: { code: "INVALID_URL", message: "Malformed request body.", suggestFallbackUpload: false } }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const url = typeof body.url === "string" && body.url.trim() ? body.url.trim() : null;
  const uploadedImage =
    body.uploadedImage && typeof body.uploadedImage.base64 === "string" && typeof body.uploadedImage.contentType === "string"
      ? body.uploadedImage
      : null;
  const duration: DurationOption = body.duration === "15" || body.duration === "30" ? body.duration : "auto";

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of runPipeline({ url, uploadedImage, duration })) {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unexpected server error.";
        controller.enqueue(
          encoder.encode(
            `${JSON.stringify({ type: "error", error: { code: "AI_CALL_FAILED", message, suggestFallbackUpload: false }, debug: null })}\n`
          )
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
