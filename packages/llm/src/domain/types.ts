export type LlmToolParameter = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
};

export type LlmToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: LlmToolParameter;
  };
};

export type LlmToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type LlmMessage =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: LlmToolCall[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

export type LlmStreamEvent =
  | { type: "content_delta"; text: string }
  | {
      type: "tool_calls_begin";
      toolCalls: Array<{ id: string; name: string }>;
    }
  | {
      type: "tool_call_args";
      id: string;
      name: string;
      arguments: string;
    }
  | { type: "tool_calls"; toolCalls: LlmToolCall[] }
  | { type: "finished"; finishReason: string | null };

export type LlmClient = {
  complete(input: {
    model: string;
    messages: LlmMessage[];
    tools?: LlmToolDefinition[];
    signal?: AbortSignal;
  }): AsyncIterable<LlmStreamEvent>;
};

export type OpenAiCompatibleConfig = {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  fetch?: typeof fetch;
};
