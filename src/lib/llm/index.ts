/* LLM provider abstraction.
   The app never calls a vendor SDK directly — everything goes through
   `complete()` so providers can be swapped via COACH_LLM_PROVIDER.
   Supports text, vision (base64 images), and tool use (for structured
   extraction). */

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

export type LlmContentPart =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: string; base64: string };

export interface LlmMessage {
  role: "user" | "assistant";
  content: string | LlmContentPart[];
}

export interface LlmTool {
  name: string;
  description: string;
  // JSON Schema for the tool input
  inputSchema: Record<string, unknown>;
}

export interface LlmToolCall {
  name: string;
  input: Record<string, unknown>;
}

export interface LlmResult {
  text: string;
  toolCalls: LlmToolCall[];
}

export interface CompleteOptions {
  system: string;
  messages: LlmMessage[];
  tools?: LlmTool[];
  /** force the model to use one of the tools */
  toolChoice?: "auto" | "any" | { name: string };
  maxTokens?: number;
  temperature?: number;
}

export interface LlmProvider {
  name: string;
  complete(opts: CompleteOptions): Promise<LlmResult>;
}

// ---------------------------------------------------------------------------

class AnthropicProvider implements LlmProvider {
  name = "anthropic";
  private client: Anthropic;
  private model: string;

  constructor() {
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    this.model = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
  }

  async complete(opts: CompleteOptions): Promise<LlmResult> {
    const messages: Anthropic.MessageParam[] = opts.messages.map((m) => ({
      role: m.role,
      content:
        typeof m.content === "string"
          ? m.content
          : m.content.map((p) =>
              p.type === "text"
                ? ({ type: "text", text: p.text } as const)
                : ({
                    type: "image",
                    source: {
                      type: "base64",
                      media_type: p.mediaType as
                        | "image/jpeg"
                        | "image/png"
                        | "image/gif"
                        | "image/webp",
                      data: p.base64,
                    },
                  } as const)
            ),
    }));

    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: opts.maxTokens ?? 2048,
      temperature: opts.temperature,
      system: opts.system,
      messages,
      tools: opts.tools?.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
      })),
      tool_choice:
        opts.toolChoice === undefined
          ? undefined
          : opts.toolChoice === "auto"
            ? { type: "auto" }
            : opts.toolChoice === "any"
              ? { type: "any" }
              : { type: "tool", name: opts.toolChoice.name },
    });

    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    const toolCalls = res.content
      .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
      .map((b) => ({ name: b.name, input: b.input as Record<string, unknown> }));
    return { text, toolCalls };
  }
}

class OpenAIProvider implements LlmProvider {
  name = "openai";
  private client: OpenAI;
  private model: string;

  constructor() {
    this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    this.model = process.env.OPENAI_MODEL || "gpt-4o";
  }

  async complete(opts: CompleteOptions): Promise<LlmResult> {
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: "system", content: opts.system },
      ...opts.messages.map(
        (m): OpenAI.ChatCompletionMessageParam =>
          typeof m.content === "string"
            ? { role: m.role, content: m.content }
            : {
                role: "user",
                content: m.content.map((p) =>
                  p.type === "text"
                    ? ({ type: "text", text: p.text } as const)
                    : ({
                        type: "image_url",
                        image_url: { url: `data:${p.mediaType};base64,${p.base64}` },
                      } as const)
                ),
              }
      ),
    ];

    const res = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: opts.maxTokens ?? 2048,
      temperature: opts.temperature,
      messages,
      tools: opts.tools?.map((t) => ({
        type: "function" as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      })),
      tool_choice:
        opts.toolChoice === undefined
          ? undefined
          : opts.toolChoice === "auto"
            ? "auto"
            : opts.toolChoice === "any"
              ? "required"
              : { type: "function", function: { name: opts.toolChoice.name } },
    });

    const choice = res.choices[0];
    const toolCalls = (choice.message.tool_calls ?? []).flatMap((tc) => {
      if (tc.type !== "function") return [];
      try {
        return [{ name: tc.function.name, input: JSON.parse(tc.function.arguments) }];
      } catch {
        return [];
      }
    });
    return { text: choice.message.content ?? "", toolCalls };  }
}

// ---------------------------------------------------------------------------

let provider: LlmProvider | null = null;

export function llmAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY);
}

export function getLlm(): LlmProvider {
  if (provider) return provider;
  const pref = process.env.COACH_LLM_PROVIDER || "anthropic";
  if (pref === "anthropic" && process.env.ANTHROPIC_API_KEY) {
    provider = new AnthropicProvider();
  } else if (pref === "openai" && process.env.OPENAI_API_KEY) {
    provider = new OpenAIProvider();
  } else if (process.env.ANTHROPIC_API_KEY) {
    provider = new AnthropicProvider();
  } else if (process.env.OPENAI_API_KEY) {
    provider = new OpenAIProvider();
  } else {
    throw new Error(
      "No LLM API key configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY."
    );
  }
  return provider;
}
