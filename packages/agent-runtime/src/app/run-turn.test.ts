import { describe, expect, it } from "vitest";
import { createCoderAgent } from "@isotope/agents";
import type { LlmClient, LlmMessage, LlmStreamEvent } from "@isotope/llm";
import { runTurn } from "./run-turn.js";

function llmFromScript(
  rounds: LlmStreamEvent[][],
): LlmClient {
  let i = 0;
  return {
    async *complete(_input) {
      const events = rounds[i++] ?? [
        { type: "finished", finishReason: "stop" } as const,
      ];
      for (const ev of events) yield ev;
    },
  };
}

const memoryStubs = {
  setPreference: () => ({ ok: true as const }),
  rememberDecision: () => ({ ok: true as const }),
};

describe("runTurn", () => {
  it("passes model to llm.complete", async () => {
    const calls: Array<{ model?: string }> = [];
    const llm: LlmClient = {
      async *complete(input) {
        calls.push({ model: input.model });
        yield { type: "content_delta", text: "ok" };
        yield { type: "finished", finishReason: "stop" };
      },
    };
    await runTurn({
      llm,
      model: "test-model",
      agent: createCoderAgent({ systemPrompt: "test" }),
      port: {
        listFiles: () => [],
        readFile: () => "",
        writeFile: () => {},
        ...memoryStubs,
      },
      history: [{ role: "user", content: "hi" }],
      maxToolRounds: 8,
      onToken: () => {},
    });
    expect(calls[0]?.model).toBe("test-model");
  });

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
      ...memoryStubs,
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
      model: "test-model",
      agent,
      port,
      history: [{ role: "user", content: "做一个空页面" }],
      maxToolRounds: 8,
      onToken: (t) => tokens.push(t),
    });
    expect(files.get("src/App.tsx")).toContain("App");
    expect(result.writtenPaths).toEqual(["src/App.tsx"]);
    expect(result.filesChanged).toBe(true);
    expect(result.assistantText).toBe("已更新 App");
    expect(tokens.join("")).toBe("已更新 App");
  });

  it("routes pre-tool content to thinking and emits tool events", async () => {
    const files = new Map<string, string>([["src/App.tsx", "old"]]);
    const port = {
      listFiles: () => [...files.keys()],
      readFile: (p: string) => files.get(p) ?? "",
      writeFile: (p: string, c: string) => {
        files.set(p, c);
      },
      ...memoryStubs,
    };
    const agent = createCoderAgent({ systemPrompt: "test" });
    const tokens: string[] = [];
    const thinking: string[] = [];
    const tools: Array<{ name: string; state: string; summary?: string }> = [];
    const phases: string[] = [];
    let display = "";

    const result = await runTurn({
      llm: llmFromScript([
        [
          { type: "content_delta", text: "我先读一下" },
          {
            type: "tool_calls",
            toolCalls: [
              {
                id: "c1",
                type: "function",
                function: {
                  name: "read_file",
                  arguments: JSON.stringify({ path: "src/App.tsx" }),
                },
              },
            ],
          },
          { type: "finished", finishReason: "tool_calls" },
        ],
        [
          { type: "content_delta", text: "读完了" },
          { type: "finished", finishReason: "stop" },
        ],
      ]),
      model: "test-model",
      agent,
      port,
      history: [{ role: "user", content: "看看 App" }],
      maxToolRounds: 8,
      onToken: (t) => {
        tokens.push(t);
        display += t;
      },
      onTokenClear: () => {
        display = "";
      },
      onThinking: (t) => thinking.push(t),
      onTool: (ev) =>
        tools.push({ name: ev.name, state: ev.state, summary: ev.summary }),
      onStatus: (p) => phases.push(p),
    });

    expect(thinking.join("")).toBe("我先读一下读完了");
    expect(display).toBe("读完了");
    expect(result.writtenPaths).toEqual([]);
    expect(result.assistantText).toBe("读完了");
    expect(result.assistantText).not.toContain("我先读一下");
    expect(tools).toEqual([
      { name: "read_file", state: "start", summary: "src/App.tsx" },
      { name: "read_file", state: "end", summary: "src/App.tsx" },
    ]);
    expect(result.process.steps).toEqual([
      { type: "thinking", text: "我先读一下" },
      {
        type: "tool",
        id: "c1",
        name: "read_file",
        status: "done",
        summary: "src/App.tsx",
      },
    ]);
    expect(phases[0]).toBe("thinking");
    expect(phases).toContain("running");
    expect(phases).toContain("streaming");
  });

  it("updates tool summary when tool_call_args peeks path before full args", async () => {
    const summaries: Array<string | undefined> = [];
    const files = new Map<string, string>();
    await runTurn({
      llm: llmFromScript([
        [
          { type: "content_delta", text: "写入中" },
          {
            type: "tool_calls_begin",
            toolCalls: [{ id: "c1", name: "write_file" }],
          },
          {
            type: "tool_call_args",
            id: "c1",
            name: "write_file",
            arguments: '{"path":"src/App.tsx","content":"',
          },
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
                    content: "export {}",
                  }),
                },
              },
            ],
          },
          { type: "finished", finishReason: "tool_calls" },
        ],
        [
          { type: "content_delta", text: "好了" },
          { type: "finished", finishReason: "stop" },
        ],
      ]),
      model: "m",
      agent: createCoderAgent({ systemPrompt: "t" }),
      port: {
        listFiles: () => [...files.keys()],
        readFile: (p) => files.get(p) ?? "",
        writeFile: (p, c) => {
          files.set(p, c);
        },
        ...memoryStubs,
      },
      history: [{ role: "user", content: "x" }],
      maxToolRounds: 8,
      onToken: () => {},
      onTokenClear: () => {},
      onThinking: () => {},
      onTool: (ev) => {
        if (ev.state === "start") summaries.push(ev.summary);
      },
    });
    expect(summaries).toContain("src/App.tsx");
    expect(summaries[0]).toBeUndefined();
  });

  it("shows tool start on tool_calls_begin before arguments finish", async () => {
    const order: string[] = [];
    const files = new Map<string, string>([["a.ts", "x"]]);
    await runTurn({
      llm: {
        async *complete() {
          yield { type: "content_delta", text: "我先改" };
          yield {
            type: "tool_calls_begin",
            toolCalls: [{ id: "c1", name: "write_file" }],
          };
          order.push("after-begin");
          yield {
            type: "tool_calls",
            toolCalls: [
              {
                id: "c1",
                type: "function",
                function: {
                  name: "write_file",
                  arguments: JSON.stringify({
                    path: "a.ts",
                    content: "export {}",
                  }),
                },
              },
            ],
          };
          yield { type: "finished", finishReason: "tool_calls" };
        },
      },
      model: "m",
      agent: createCoderAgent({ systemPrompt: "t" }),
      port: {
        listFiles: () => [...files.keys()],
        readFile: (p: string) => files.get(p) ?? "",
        writeFile: (p, c) => {
          files.set(p, c);
        },
        ...memoryStubs,
      },
      history: [{ role: "user", content: "x" }],
      maxToolRounds: 2,
      onToken: () => {},
      onTokenClear: () => {},
      onThinking: () => {},
      onTool: (ev) => {
        if (ev.state === "start") order.push(`start:${ev.name}`);
        if (ev.state === "end") order.push(`end:${ev.name}`);
      },
    });
    expect(order.indexOf("start:write_file")).toBeLessThan(
      order.indexOf("after-begin"),
    );
  });

  it("streams thinking before tools when content precedes tool_calls", async () => {
    const order: string[] = [];
    const files = new Map<string, string>([["a.ts", "x"]]);
    await runTurn({
      llm: llmFromScript([
        [
          { type: "content_delta", text: "旁白" },
          {
            type: "tool_calls",
            toolCalls: [
              {
                id: "c1",
                type: "function",
                function: {
                  name: "read_file",
                  arguments: JSON.stringify({ path: "a.ts" }),
                },
              },
            ],
          },
          { type: "finished", finishReason: "tool_calls" },
        ],
        [
          { type: "content_delta", text: "ok" },
          { type: "finished", finishReason: "stop" },
        ],
      ]),
      model: "m",
      agent: createCoderAgent({ systemPrompt: "t" }),
      port: {
        listFiles: () => [...files.keys()],
        readFile: (p: string) => files.get(p) ?? "",
        writeFile: () => {},
        ...memoryStubs,
      },
      history: [{ role: "user", content: "x" }],
      maxToolRounds: 8,
      onToken: () => order.push("token"),
      onTokenClear: () => order.push("token_clear"),
      onThinking: () => order.push("thinking"),
      onTool: (ev) => order.push(`tool:${ev.state}`),
    });
    const thinkingAt = order.indexOf("thinking");
    const toolAt = order.indexOf("tool:start");
    expect(thinkingAt).toBeGreaterThanOrEqual(0);
    expect(toolAt).toBeGreaterThan(thinkingAt);
  });

  it("streams content_delta via onToken before finished (no tools)", async () => {
    const order: string[] = [];
    const llm: LlmClient = {
      async *complete() {
        yield { type: "content_delta", text: "你" };
        order.push("delta");
        yield { type: "content_delta", text: "好" };
        yield { type: "finished", finishReason: "stop" };
        order.push("finished");
      },
    };
    const tokens: string[] = [];
    let clears = 0;
    const result = await runTurn({
      llm,
      model: "m",
      agent: createCoderAgent({ systemPrompt: "t" }),
      port: {
        listFiles: () => [],
        readFile: () => "",
        writeFile: () => {},
        ...memoryStubs,
      },
      history: [{ role: "user", content: "hi" }],
      maxToolRounds: 8,
      onToken: (t) => {
        tokens.push(t);
        order.push(`token:${t}`);
      },
      onThinkingClear: () => {
        clears += 1;
      },
    });
    expect(tokens).toEqual(["你", "好"]);
    expect(order.indexOf("token:你")).toBeLessThan(order.indexOf("finished"));
    expect(clears).toBe(1);
    expect(result.process.steps).toEqual([]);
  });

  it("tool_calls_begin demotes early; later content_delta only thinking", async () => {
    const files = new Map<string, string>([["a.ts", "x"]]);
    const tokens: string[] = [];
    const thinking: string[] = [];
    let clears = 0;
    const result = await runTurn({
      llm: llmFromScript([
        [
          { type: "content_delta", text: "旁白" },
          { type: "tool_calls_begin", toolCalls: [{ id: "c1", name: "read_file" }] },
          { type: "content_delta", text: "更多" },
          {
            type: "tool_calls",
            toolCalls: [
              {
                id: "c1",
                type: "function",
                function: {
                  name: "read_file",
                  arguments: JSON.stringify({ path: "a.ts" }),
                },
              },
            ],
          },
          { type: "finished", finishReason: "tool_calls" },
        ],
        [
          { type: "content_delta", text: "ok" },
          { type: "finished", finishReason: "stop" },
        ],
      ]),
      model: "m",
      agent: createCoderAgent({ systemPrompt: "t" }),
      port: {
        listFiles: () => [...files.keys()],
        readFile: (p: string) => files.get(p) ?? "",
        writeFile: () => {},
        ...memoryStubs,
      },
      history: [{ role: "user", content: "x" }],
      maxToolRounds: 8,
      onToken: (t) => tokens.push(t),
      onTokenClear: () => {
        clears += 1;
      },
      onThinking: (t) => thinking.push(t),
    });
    expect(tokens.filter((t) => t !== "ok")).toEqual(["旁白"]);
    expect(clears).toBe(1);
    expect(thinking.join("")).toBe("旁白更多ok");
    expect(result.assistantText).toBe("ok");
    expect(result.process.steps).toEqual([
      { type: "thinking", text: "旁白更多" },
      {
        type: "tool",
        id: "c1",
        name: "read_file",
        status: "done",
        summary: "a.ts",
      },
    ]);
  });

  it("summarizes write_file path and list_files dir", async () => {
    const files = new Map<string, string>();
    const port = {
      listFiles: (relativeDir?: string) =>
        relativeDir ? [...files.keys()].filter((p) => p.startsWith(relativeDir)) : [...files.keys()],
      readFile: (p: string) => files.get(p) ?? "",
      writeFile: (p: string, c: string) => {
        files.set(p, c);
      },
      ...memoryStubs,
    };
    const agent = createCoderAgent({ systemPrompt: "test" });
    const tools: Array<{ name: string; state: string; summary?: string }> = [];

    await runTurn({
      llm: llmFromScript([
        [
          {
            type: "tool_calls",
            toolCalls: [
              {
                id: "c1",
                type: "function",
                function: {
                  name: "list_files",
                  arguments: JSON.stringify({}),
                },
              },
              {
                id: "c2",
                type: "function",
                function: {
                  name: "list_files",
                  arguments: JSON.stringify({ relativeDir: "src" }),
                },
              },
              {
                id: "c3",
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
          { type: "content_delta", text: "好了" },
          { type: "finished", finishReason: "stop" },
        ],
      ]),
      model: "test-model",
      agent,
      port,
      history: [{ role: "user", content: "写一下" }],
      maxToolRounds: 8,
      onToken: () => {},
      onTool: (ev) =>
        tools.push({ name: ev.name, state: ev.state, summary: ev.summary }),
    });

    expect(tools).toEqual([
      { name: "list_files", state: "start", summary: "." },
      { name: "list_files", state: "end", summary: "." },
      { name: "list_files", state: "start", summary: "src" },
      { name: "list_files", state: "end", summary: "src" },
      { name: "write_file", state: "start", summary: "src/App.tsx" },
      { name: "write_file", state: "end", summary: "src/App.tsx" },
    ]);
  });

  it("truncates large tool results before next llm.complete", async () => {
    const largeContent = "x".repeat(9000);
    const port = {
      listFiles: () => ["big.txt"],
      readFile: () => largeContent,
      writeFile: () => {},
      ...memoryStubs,
    };
    const agent = createCoderAgent({ systemPrompt: "test" });
    const capturedMessages: LlmMessage[][] = [];
    let callIndex = 0;
    const llm: LlmClient = {
      async *complete(input) {
        capturedMessages.push([...input.messages]);
        if (callIndex === 0) {
          callIndex++;
          yield {
            type: "tool_calls",
            toolCalls: [
              {
                id: "c1",
                type: "function",
                function: {
                  name: "read_file",
                  arguments: JSON.stringify({ path: "big.txt" }),
                },
              },
            ],
          };
          yield { type: "finished", finishReason: "tool_calls" };
          return;
        }
        yield { type: "content_delta", text: "done" };
        yield { type: "finished", finishReason: "stop" };
      },
    };

    await runTurn({
      llm,
      model: "test-model",
      agent,
      port,
      history: [{ role: "user", content: "读大文件" }],
      maxToolRounds: 8,
      onToken: () => {},
    });

    const toolMsg = capturedMessages[1]?.find((m) => m.role === "tool");
    const suffix = "\n…(已截断，可再 read_file)";
    expect(toolMsg?.content).toContain(suffix);
    expect(toolMsg?.content?.length).toBe(8000 + suffix.length);
  });

  it("truncates large tool error content before next llm.complete", async () => {
    const largeError = "e".repeat(9000);
    const agent = {
      ...createCoderAgent({ systemPrompt: "test" }),
      executeTool: () => ({ ok: false as const, error: largeError }),
    };
    const capturedMessages: LlmMessage[][] = [];
    let callIndex = 0;
    const llm: LlmClient = {
      async *complete(input) {
        capturedMessages.push([...input.messages]);
        if (callIndex === 0) {
          callIndex++;
          yield {
            type: "tool_calls",
            toolCalls: [
              {
                id: "c1",
                type: "function",
                function: {
                  name: "read_file",
                  arguments: JSON.stringify({ path: "missing.txt" }),
                },
              },
            ],
          };
          yield { type: "finished", finishReason: "tool_calls" };
          return;
        }
        yield { type: "content_delta", text: "done" };
        yield { type: "finished", finishReason: "stop" };
      },
    };

    await runTurn({
      llm,
      model: "test-model",
      agent,
      port: {
        listFiles: () => [],
        readFile: () => "",
        writeFile: () => {},
        ...memoryStubs,
      },
      history: [{ role: "user", content: "读文件" }],
      maxToolRounds: 8,
      onToken: () => {},
    });

    const toolMsg = capturedMessages[1]?.find((m) => m.role === "tool");
    const suffix = "\n…(已截断，可再 read_file)";
    expect(toolMsg?.content).toContain(suffix);
    expect(toolMsg?.content?.length).toBe(8000 + suffix.length);
  });

  it("awaits async executeTool results before continuing", async () => {
    let resolveTool!: (value: { ok: true; result: string }) => void;
    const toolPromise = new Promise<{ ok: true; result: string }>((resolve) => {
      resolveTool = resolve;
    });
    const agent = {
      ...createCoderAgent({ systemPrompt: "test" }),
      executeTool: () => toolPromise,
    };
    const tokens: string[] = [];
    const turnPromise = runTurn({
      llm: llmFromScript([
        [
          {
            type: "tool_calls",
            toolCalls: [
              {
                id: "c1",
                type: "function",
                function: {
                  name: "list_files",
                  arguments: "{}",
                },
              },
            ],
          },
          { type: "finished", finishReason: "tool_calls" },
        ],
        [
          { type: "content_delta", text: "done" },
          { type: "finished", finishReason: "stop" },
        ],
      ]),
      model: "test-model",
      agent,
      port: {
        listFiles: () => [],
        readFile: () => "",
        writeFile: () => {},
        ...memoryStubs,
      },
      history: [{ role: "user", content: "list" }],
      maxToolRounds: 8,
      onToken: (t) => tokens.push(t),
    });

    await Promise.resolve();
    expect(tokens).toEqual([]);
    resolveTool({ ok: true, result: "[]" });
    const result = await turnPromise;
    expect(result.assistantText).toBe("done");
    expect(tokens.join("")).toBe("done");
  });

  it("returns round-limit note when maxToolRounds exhausted with thinking but no final text", async () => {
    const files = new Map<string, string>([["src/App.tsx", "x"]]);
    const port = {
      listFiles: () => [...files.keys()],
      readFile: (p: string) => files.get(p) ?? "",
      writeFile: (p: string, c: string) => {
        files.set(p, c);
      },
      ...memoryStubs,
    };
    const agent = createCoderAgent({ systemPrompt: "test" });
    const tokens: string[] = [];
    let display = "";
    const toolRound = (id: string): LlmStreamEvent[] => [
      { type: "content_delta", text: `想读 ${id}` },
      {
        type: "tool_calls",
        toolCalls: [
          {
            id,
            type: "function",
            function: {
              name: "read_file",
              arguments: JSON.stringify({ path: "src/App.tsx" }),
            },
          },
        ],
      },
      { type: "finished", finishReason: "tool_calls" },
    ];

    const result = await runTurn({
      llm: llmFromScript([toolRound("c1"), toolRound("c2")]),
      model: "test-model",
      agent,
      port,
      history: [{ role: "user", content: "看一眼" }],
      maxToolRounds: 2,
      onToken: (t) => {
        tokens.push(t);
        display += t;
      },
      onTokenClear: () => {
        display = "";
      },
    });

    expect(result.assistantText).toBe("（已达工具轮次上限）");
    expect(result.writtenPaths).toEqual([]);
    expect(display).toBe("（已达工具轮次上限）");
    expect(result.process.steps.some((s) => s.type === "thinking")).toBe(true);
    expect(
      result.process.steps.filter((s) => s.type === "tool"),
    ).toHaveLength(2);
  });
});
