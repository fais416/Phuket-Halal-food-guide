// AI provider wrapper.
//
// Provider: Anthropic Claude, chosen specifically because it accepts a real
// image (base64) plus text in a single request — this app genuinely sends
// downloaded product photos into the model rather than just pasting a URL
// and hoping the model "reads" it. Every model in the Claude 3.x/4.x family
// supports image input; legacy claude-2/instant models do not, so we guard
// against being pointed at one.

import Anthropic from "@anthropic-ai/sdk";

export class AiNotConfiguredError extends Error {
  code = "AI_NOT_CONFIGURED" as const;
}
export class AiCallFailedError extends Error {
  code = "AI_CALL_FAILED" as const;
}

const NON_VISION_MODEL_PATTERNS = [/claude-2/i, /claude-instant/i];

function getModel(): string {
  return process.env.AI_MODEL?.trim() || "claude-sonnet-4-5-20250929";
}

function assertVisionCapable(model: string) {
  if (NON_VISION_MODEL_PATTERNS.some((p) => p.test(model))) {
    throw new AiNotConfiguredError(
      `AI_MODEL is set to "${model}", which does not support image input. ` +
        "Set AI_MODEL to a Claude 3.x or 4.x model (e.g. claude-sonnet-4-5-20250929)."
    );
  }
}

let cachedClient: Anthropic | null = null;

export function getAiClient(): Anthropic {
  const apiKey = process.env.AI_API_KEY?.trim();
  if (!apiKey) {
    throw new AiNotConfiguredError(
      "AI_API_KEY is not set. Add it to your environment (see .env.example) with a valid Anthropic API key from https://console.anthropic.com/settings/keys."
    );
  }
  if (!cachedClient) {
    cachedClient = new Anthropic({ apiKey });
  }
  return cachedClient;
}

export function isAiConfigured(): boolean {
  return Boolean(process.env.AI_API_KEY?.trim());
}

type JsonSchema = Record<string, unknown>;

async function callWithTool<T>(params: {
  system: string;
  content: Anthropic.MessageParam["content"];
  toolName: string;
  toolDescription: string;
  schema: JsonSchema;
  maxTokens?: number;
}): Promise<T> {
  const model = getModel();
  assertVisionCapable(model);
  const client = getAiClient();

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model,
      max_tokens: params.maxTokens ?? 4096,
      system: params.system,
      messages: [{ role: "user", content: params.content }],
      tools: [
        {
          name: params.toolName,
          description: params.toolDescription,
          input_schema: params.schema as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: "tool", name: params.toolName },
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new AiCallFailedError(`The AI provider call failed: ${detail}`);
  }

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === params.toolName
  );
  if (!toolUse) {
    throw new AiCallFailedError("The AI response did not include the expected structured output.");
  }
  return toolUse.input as T;
}

export async function callStructured<T>(params: {
  system: string;
  prompt: string;
  toolName: string;
  toolDescription: string;
  schema: JsonSchema;
  maxTokens?: number;
}): Promise<T> {
  return callWithTool<T>({
    system: params.system,
    content: [{ type: "text", text: params.prompt }],
    toolName: params.toolName,
    toolDescription: params.toolDescription,
    schema: params.schema,
    maxTokens: params.maxTokens,
  });
}

export async function callStructuredWithImage<T>(params: {
  system: string;
  prompt: string;
  imageBase64: string;
  imageMediaType: "image/jpeg" | "image/png" | "image/webp";
  toolName: string;
  toolDescription: string;
  schema: JsonSchema;
  maxTokens?: number;
}): Promise<T> {
  return callWithTool<T>({
    system: params.system,
    content: [
      {
        type: "image",
        source: { type: "base64", media_type: params.imageMediaType, data: params.imageBase64 },
      },
      { type: "text", text: params.prompt },
    ],
    toolName: params.toolName,
    toolDescription: params.toolDescription,
    schema: params.schema,
    maxTokens: params.maxTokens,
  });
}
