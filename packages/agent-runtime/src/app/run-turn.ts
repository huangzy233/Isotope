import type { WorkspaceToolPort } from "@isotope/agents";
import type { LlmMessage } from "@isotope/llm";
import type {
  RunTurnInput,
  RunTurnResult,
  TurnProcess,
  TurnProcessStep,
} from "../domain/types.js";
import { toolSummary } from "./tool-summary.js";

const ROUND_LIMIT_NOTE = "（已达工具轮次上限）";
const TOOL_RESULT_MAX_CHARS = 8000;
const TOOL_RESULT_TRUNCATED_SUFFIX = "\n…(已截断，可再 read_file)";

function clipToolContent(content: string, max: number): string {
  if (content.length <= max) return content;
  return content.slice(0, max) + TOOL_RESULT_TRUNCATED_SUFFIX;
}

function appendThinking(process: TurnProcess, text: string): void {
  const last = process.steps[process.steps.length - 1];
  if (last?.type === "thinking") {
    last.text += text;
    return;
  }
  process.steps.push({ type: "thinking", text });
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
    onThinking,
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
    const roundChunks: string[] = [];

    for await (const ev of llm.complete({
      model,
      messages,
      tools: agent.tools,
      signal,
    })) {
      if (ev.type === "content_delta") {
        roundChunks.push(ev.text);
        continue;
      }

      if (ev.type === "tool_calls") {
        hadToolCalls = true;
        const thinkingText = roundChunks.join("");
        roundChunks.length = 0;
        if (thinkingText.length > 0) {
          onThinking?.(thinkingText);
          appendThinking(process, thinkingText);
        }
        onStatus?.("running");

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
          onTool?.({
            id: call.id,
            name: call.function.name,
            state: "start",
            summary,
          });
          process.steps.push({
            type: "tool",
            id: call.id,
            name: call.function.name,
            status: "running",
            summary,
          });

          const outcome = agent.executeTool(
            call.function.name,
            call.function.arguments,
            port,
          );

          const toolStep = process.steps[process.steps.length - 1];
          if (toolStep?.type === "tool" && toolStep.id === call.id) {
            toolStep.status = outcome.ok ? "done" : "error";
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
      onStatus?.("streaming");
      for (const chunk of roundChunks) {
        onToken(chunk);
        assistantText += chunk;
      }
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
