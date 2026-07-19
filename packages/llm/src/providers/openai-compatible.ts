import type {
  LlmClient,
  LlmStreamEvent,
  LlmToolCall,
  OpenAiCompatibleConfig,
} from "../domain/types.js";

type StreamDeltaToolCall = {
  index: number;
  id?: string;
  type?: "function";
  function?: { name?: string; arguments?: string };
};

type StreamChunk = {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: StreamDeltaToolCall[];
    };
    finish_reason?: string | null;
  }>;
};

function combineSignals(
  timeoutMs: number,
  signal?: AbortSignal,
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeout;
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([timeout, signal]);
  }
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (timeout.aborted || signal.aborted) {
    controller.abort();
    return controller.signal;
  }
  timeout.addEventListener("abort", onAbort, { once: true });
  signal.addEventListener("abort", onAbort, { once: true });
  return controller.signal;
}

function aggregateToolCalls(
  byIndex: Map<number, LlmToolCall>,
): LlmToolCall[] {
  return [...byIndex.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, call]) => call);
}

async function* parseSseStream(
  body: ReadableStream<Uint8Array> | null,
): AsyncGenerator<StreamChunk> {
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const rawLine of lines) {
        const line = rawLine.trimEnd();
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (!data || data === "[DONE]") return;
        try {
          yield JSON.parse(data) as StreamChunk;
        } catch {
          // ignore malformed SSE payloads
        }
      }
    }

    const trailing = buffer.trim();
    if (trailing.startsWith("data: ")) {
      const data = trailing.slice(6).trim();
      if (data && data !== "[DONE]") {
        try {
          yield JSON.parse(data) as StreamChunk;
        } catch {
          // ignore malformed SSE payloads
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function namedToolSnapshot(
  byIndex: Map<number, LlmToolCall>,
): Array<{ id: string; name: string }> {
  return aggregateToolCalls(byIndex)
    .filter((c) => c.id.length > 0 && c.function.name.length > 0)
    .map((c) => ({
      id: c.id,
      name: c.function.name,
    }));
}

/** True when partial args already contain a closed label field (path / dir). */
function hasPeekableToolLabel(name: string, argsSoFar: string): boolean {
  if (name === "read_file" || name === "write_file") {
    return /"path"\s*:\s*"(?:\\.|[^"\\])*"/.test(argsSoFar);
  }
  if (name === "list_files") {
    return (
      argsSoFar.includes("{") &&
      (/"relativeDir"\s*:\s*"(?:\\.|[^"\\])*"/.test(argsSoFar) ||
        argsSoFar.includes("}"))
    );
  }
  return false;
}

export function createOpenAiCompatibleClient(
  config: OpenAiCompatibleConfig,
): LlmClient {
  const fetchFn = config.fetch ?? globalThis.fetch;

  return {
    async *complete(input): AsyncIterable<LlmStreamEvent> {
      const url = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;
      const response = await fetchFn(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: input.model,
          messages: input.messages,
          tools: input.tools,
          stream: true,
          tool_choice: input.tools?.length ? "auto" : undefined,
        }),
        signal: combineSignals(config.timeoutMs, input.signal),
      });

      if (!response.ok) {
        const bodyText = await response.text();
        const truncated =
          bodyText.length > 500 ? `${bodyText.slice(0, 500)}…` : bodyText;
        throw new Error(
          `OpenAI-compatible request failed: ${response.status} ${truncated}`,
        );
      }

      const toolCallsByIndex = new Map<number, LlmToolCall>();
      let finishReason: string | null = null;
      let emittedToolCallsBegin = false;
      const summaryArgsEmitted = new Set<string>();

      for await (const chunk of parseSseStream(response.body)) {
        const choice = chunk.choices?.[0];
        if (!choice) continue;

        if (choice.finish_reason != null) {
          finishReason = choice.finish_reason;
        }

        const content = choice.delta?.content;
        if (typeof content === "string" && content.length > 0) {
          yield { type: "content_delta", text: content };
        }

        for (const delta of choice.delta?.tool_calls ?? []) {
          const existing = toolCallsByIndex.get(delta.index);
          if (!existing) {
            toolCallsByIndex.set(delta.index, {
              id: delta.id ?? "",
              type: "function",
              function: {
                name: delta.function?.name ?? "",
                arguments: delta.function?.arguments ?? "",
              },
            });
          } else {
            if (delta.id) existing.id = delta.id;
            if (delta.function?.name) {
              existing.function.name = delta.function.name;
            }
            if (delta.function?.arguments) {
              existing.function.arguments += delta.function.arguments;
            }
          }

          if (!emittedToolCallsBegin) {
            const named = namedToolSnapshot(toolCallsByIndex);
            if (named.length > 0) {
              emittedToolCallsBegin = true;
              yield { type: "tool_calls_begin", toolCalls: named };
            }
          }

          const call = toolCallsByIndex.get(delta.index);
          if (
            call &&
            call.id &&
            call.function.name &&
            !summaryArgsEmitted.has(call.id) &&
            hasPeekableToolLabel(call.function.name, call.function.arguments)
          ) {
            summaryArgsEmitted.add(call.id);
            yield {
              type: "tool_call_args",
              id: call.id,
              name: call.function.name,
              arguments: call.function.arguments,
            };
          }
        }
      }

      if (toolCallsByIndex.size > 0) {
        yield {
          type: "tool_calls",
          toolCalls: aggregateToolCalls(toolCallsByIndex),
        };
      }

      yield { type: "finished", finishReason };
    },
  };
}
