import type { WorkspaceToolPort } from "@isotope/agents";
import type { LlmMessage } from "@isotope/llm";
import type {
  RunTurnInput,
  RunTurnResult,
  TurnProcess,
  TurnProcessStep,
} from "../domain/types.js";
import { peekToolSummary, toolSummary } from "./tool-summary.js";

const ROUND_LIMIT_NOTE = "（已达工具轮次上限）";
const TOOL_RESULT_MAX_CHARS = 8000;
const TOOL_RESULT_TRUNCATED_SUFFIX = "\n…(已截断，可再 read_file)";

function clipToolContent(content: string, max: number): string {
  if (content.length <= max) return content;
  return content.slice(0, max) + TOOL_RESULT_TRUNCATED_SUFFIX;
}

function appendThinking(
  process: TurnProcess,
  text: string,
  opts?: { beforeTrailingTools?: boolean },
): void {
  const last = process.steps[process.steps.length - 1];
  if (last?.type === "thinking") {
    last.text += text;
    return;
  }
  if (opts?.beforeTrailingTools) {
    // Tools may appear early (tool_calls_begin); keep later deltas on the
    // thinking step that precedes this round's trailing tools.
    let i = process.steps.length - 1;
    while (i >= 0 && process.steps[i]?.type === "tool") i -= 1;
    if (i >= 0 && process.steps[i]?.type === "thinking") {
      process.steps[i] = {
        type: "thinking",
        text:
          (process.steps[i] as { type: "thinking"; text: string }).text + text,
      };
      return;
    }
    process.steps.splice(i + 1, 0, { type: "thinking", text });
    return;
  }
  process.steps.push({ type: "thinking", text });
}

function revokeTrailingThinking(process: TurnProcess): void {
  while (process.steps.length > 0) {
    const last = process.steps[process.steps.length - 1];
    if (last?.type !== "thinking") break;
    process.steps.pop();
  }
}

function hasThinking(steps: TurnProcessStep[]): boolean {
  return steps.some((s) => s.type === "thinking" && s.text.length > 0);
}

export async function runTurn<TPort = WorkspaceToolPort>(
  input: RunTurnInput<TPort>,
): Promise<RunTurnResult> {
  const {
    llm,
    model,
    agent,
    port,
    history,
    maxToolRounds,
    toolResultMaxChars = TOOL_RESULT_MAX_CHARS,
    signal,
    onToken,
    onTokenClear,
    onThinking,
    onThinkingClear,
    onTool,
    onStatus,
  } = input;

  const messages: LlmMessage[] = [
    { role: "system", content: agent.systemPrompt },
    ...history.map((m) =>
      m.role === "user"
        ? ({ role: "user", content: m.content } as const)
        : ({
            role: "assistant",
            content: m.content,
          } as const),
    ),
  ];

  let filesChanged = false;
  const writtenPaths: string[] = [];
  let assistantText = "";
  const process: TurnProcess = { steps: [] };

  onStatus?.("thinking");

  for (let round = 0; round < maxToolRounds; round++) {
    let hadToolCalls = false;
    let isToolRound = false;
    let roundBuffer = "";
    let speculativeTokens = "";
    let startedStreaming = false;
    const startedToolIds = new Set<string>();

    const markToolRound = () => {
      if (isToolRound) return;
      isToolRound = true;
      if (speculativeTokens.length > 0) {
        onTokenClear?.();
        speculativeTokens = "";
      }
      onStatus?.("running");
    };

    const ensureToolStarted = (
      id: string,
      name: string,
      summary?: string,
    ) => {
      if (startedToolIds.has(id)) {
        const existing = process.steps.find(
          (s) => s.type === "tool" && s.id === id,
        );
        if (
          existing?.type === "tool" &&
          summary &&
          existing.summary !== summary
        ) {
          existing.summary = summary;
          onTool?.({ id, name, state: "start", summary });
        }
        return;
      }
      startedToolIds.add(id);
      onTool?.({ id, name, state: "start", summary });
      process.steps.push({
        type: "tool",
        id,
        name,
        status: "running",
        summary,
      });
    };

    for await (const ev of llm.complete({
      model,
      messages,
      tools: agent.tools,
      signal,
    })) {
      if (ev.type === "content_delta") {
        roundBuffer += ev.text;
        // Always stream into process first so tools never appear above thinking.
        onThinking?.(ev.text);
        appendThinking(process, ev.text, {
          beforeTrailingTools: isToolRound,
        });
        if (!isToolRound) {
          if (!startedStreaming) {
            startedStreaming = true;
            onStatus?.("streaming");
          }
          onToken(ev.text);
          speculativeTokens += ev.text;
        }
        continue;
      }

      if (ev.type === "tool_calls_begin") {
        markToolRound();
        for (const t of ev.toolCalls) {
          if (!t.id || !t.name) continue;
          ensureToolStarted(t.id, t.name);
        }
        continue;
      }

      if (ev.type === "tool_call_args") {
        markToolRound();
        const summary =
          peekToolSummary(ev.name, ev.arguments) ??
          toolSummary(ev.name, ev.arguments);
        ensureToolStarted(ev.id, ev.name, summary);
        continue;
      }

      if (ev.type === "tool_calls") {
        hadToolCalls = true;
        markToolRound();
        const thinkingText = roundBuffer;
        roundBuffer = "";

        messages.push({
          role: "assistant",
          content: thinkingText.length > 0 ? thinkingText : null,
          tool_calls: ev.toolCalls,
        });

        for (const call of ev.toolCalls) {
          const summary = toolSummary(
            call.function.name,
            call.function.arguments,
          );
          ensureToolStarted(call.id, call.function.name, summary);

          const outcome = await Promise.resolve(
            agent.executeTool(
              call.function.name,
              call.function.arguments,
              port,
            ),
          );

          const toolStep = process.steps.find(
            (s) => s.type === "tool" && s.id === call.id,
          );
          if (toolStep?.type === "tool") {
            toolStep.status = outcome.ok ? "done" : "error";
            if (summary) toolStep.summary = summary;
          }

          onTool?.({
            id: call.id,
            name: call.function.name,
            state: "end",
            summary,
            ok: outcome.ok,
          });

          if (call.function.name === "write_file" && outcome.ok) {
            filesChanged = true;
            try {
              const path = JSON.parse(call.function.arguments).path;
              if (
                typeof path === "string" &&
                path &&
                !writtenPaths.includes(path)
              ) {
                writtenPaths.push(path);
              }
            } catch {
              /* ignore */
            }
          }
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: clipToolContent(
              outcome.ok ? outcome.result : outcome.error,
              toolResultMaxChars,
            ),
          });
        }
        continue;
      }

      // finished — reason unused beyond loop control
    }

    if (!hadToolCalls) {
      // Final answer lived briefly in process as thinking; promote to content only.
      revokeTrailingThinking(process);
      onThinkingClear?.();
      assistantText += speculativeTokens;
      return { assistantText, filesChanged, writtenPaths, process };
    }
  }

  if (assistantText.length > 0) {
    onToken(ROUND_LIMIT_NOTE);
    assistantText += ROUND_LIMIT_NOTE;
    return { assistantText, filesChanged, writtenPaths, process };
  }

  if (hasThinking(process.steps)) {
    onToken(ROUND_LIMIT_NOTE);
    assistantText = ROUND_LIMIT_NOTE;
    return { assistantText, filesChanged, writtenPaths, process };
  }

  throw new Error("工具调用轮次过多");
}
