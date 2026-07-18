import { describe, expect, it, vi } from "vitest";
import { createCoderAgent } from "@isotope/agents";
import type { LlmClient, LlmStreamEvent } from "@isotope/llm";
import { runTurn } from "./run-turn.js";

function llmFromScript(
  rounds: LlmStreamEvent[][],
): LlmClient {
  let i = 0;
  return {
    async *complete() {
      const events = rounds[i++] ?? [
        { type: "finished", finishReason: "stop" } as const,
      ];
      for (const ev of events) yield ev;
    },
  };
}

describe("runTurn", () => {
  it("executes write_file tool then streams final text", async () => {
    const files = new Map<string, string>();
    const port = {
      listFiles: () => [...files.keys()],
      readFile: (p: string) => {
        const v = files.get(p);
        if (v === undefined) throw new Error("missing");
        return v;
      },
      writeFile: (p: string, c: string) => {
        files.set(p, c);
      },
    };
    const agent = createCoderAgent({ systemPrompt: "test" });
    const tokens: string[] = [];
    const result = await runTurn({
      llm: llmFromScript([
        [
          {
            type: "tool_calls",
            toolCalls: [
              {
                id: "c1",
                type: "function",
                function: {
                  name: "write_file",
                  arguments: JSON.stringify({
                    path: "src/App.tsx",
                    content: "export default function App(){return null}",
                  }),
                },
              },
            ],
          },
          { type: "finished", finishReason: "tool_calls" },
        ],
        [
          { type: "content_delta", text: "已更新 App" },
          { type: "finished", finishReason: "stop" },
        ],
      ]),
      agent,
      port,
      history: [{ role: "user", content: "做一个空页面" }],
      maxToolRounds: 8,
      onToken: (t) => tokens.push(t),
    });
    expect(files.get("src/App.tsx")).toContain("App");
    expect(result.filesChanged).toBe(true);
    expect(result.assistantText).toBe("已更新 App");
    expect(tokens.join("")).toBe("已更新 App");
  });
});
