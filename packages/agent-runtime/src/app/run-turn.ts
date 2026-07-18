import type { LlmMessage } from "@isotope/llm";
import type { RunTurnInput, RunTurnResult } from "../domain/types.js";

const ROUND_LIMIT_NOTE = "（已达工具轮次上限）";

export async function runTurn(input: RunTurnInput): Promise<RunTurnResult> {
  const { llm, agent, port, history, maxToolRounds, signal, onToken } = input;

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
  let assistantText = "";

  for (let round = 0; round < maxToolRounds; round++) {
    let hadToolCalls = false;
    let roundContent = "";

    for await (const ev of llm.complete({
      messages,
      tools: agent.tools,
      signal,
    })) {
      if (ev.type === "content_delta") {
        roundContent += ev.text;
        assistantText += ev.text;
        onToken(ev.text);
        continue;
      }

      if (ev.type === "tool_calls") {
        hadToolCalls = true;
        messages.push({
          role: "assistant",
          content: roundContent.length > 0 ? roundContent : null,
          tool_calls: ev.toolCalls,
        });
        for (const call of ev.toolCalls) {
          const outcome = agent.executeTool(
            call.function.name,
            call.function.arguments,
            port,
          );
          if (call.function.name === "write_file" && outcome.ok) {
            filesChanged = true;
          }
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: outcome.ok ? outcome.result : outcome.error,
          });
        }
        continue;
      }

      // finished — reason unused beyond loop control
    }

    if (!hadToolCalls) {
      return { assistantText, filesChanged };
    }
  }

  if (assistantText.length > 0) {
    onToken(ROUND_LIMIT_NOTE);
    assistantText += ROUND_LIMIT_NOTE;
    return { assistantText, filesChanged };
  }

  throw new Error("工具调用轮次过多");
}
