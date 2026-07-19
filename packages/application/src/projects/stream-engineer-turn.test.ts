import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCoderAgent } from "@isotope/agents";
import type { LlmClient, LlmStreamEvent } from "@isotope/llm";
import {
  createPreferenceStore,
  type PreferenceStore,
} from "@isotope/memory";
import type { PreviewService, PreviewStatusSnapshot } from "@isotope/preview";
import { createFsSqliteWorkspace } from "@isotope/workspace";
import { createProject } from "./create-project.js";
import { ASSISTANT_PLACEHOLDER } from "./placeholder.js";
import { DECISIONS_PATH } from "./project-memory-paths.js";
import {
  beginEngineerTurn,
  type EngineerTurnEvent,
} from "./stream-engineer-turn.js";
import { subscribeTurn } from "./turn-hub.js";

const fakePreferences: PreferenceStore = {
  getPreferences: () => ({}),
  upsertPreference: () => {},
};

const templatePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../templates/vite-react",
);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readySnapshot(): PreviewStatusSnapshot {
  return {
    status: "ready",
    revision: "rev-1",
    error: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function mockPreview(
  overrides: Partial<PreviewService> = {},
): PreviewService {
  return {
    getStatus: vi.fn(() => readySnapshot()),
    ensureBuild: vi.fn(() => readySnapshot()),
    enqueueBuild: vi.fn(() => readySnapshot()),
    readAsset: vi.fn(() => null),
    ...overrides,
  };
}

function llmFromScript(rounds: LlmStreamEvent[][]): LlmClient {
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

function llmWithDelay(
  rounds: LlmStreamEvent[][],
  delayMs: number,
): LlmClient {
  let i = 0;
  return {
    async *complete(_input) {
      await delay(delayMs);
      const events = rounds[i++] ?? [
        { type: "finished", finishReason: "stop" } as const,
      ];
      for (const ev of events) yield ev;
    },
  };
}

async function runAndCollect(
  projectId: string,
  run: () => Promise<void>,
): Promise<EngineerTurnEvent[]> {
  const events: EngineerTurnEvent[] = [];
  const unsub = subscribeTurn(projectId, (e) =>
    events.push(e as EngineerTurnEvent),
  );
  await run();
  unsub?.();
  return events;
}

describe("beginEngineerTurn", () => {
  let dataRoot: string;
  let workspace: ReturnType<typeof createFsSqliteWorkspace>;

  beforeEach(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "iso-app-turn-"));
    workspace = createFsSqliteWorkspace({ dataRoot, templatePath });
  });

  afterEach(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  it("continue replaces placeholder, streams tokens, enqueues preview after write_file", async () => {
    const { project } = createProject(
      {
        ownerUserId: "demo",
        requirement: "做一个空页面",
        mode: "engineer",
      },
      workspace,
    );
    const preview = mockPreview();

    const begun = beginEngineerTurn(
      {
        ownerUserId: "demo",
        projectId: project.id,
        action: "continue",
      },
      {
        workspace,
        preferences: fakePreferences,
        preview,
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
                      content:
                        "export default function App(){return null}",
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
        agent: createCoderAgent({ systemPrompt: "test" }),
        model: "test-model",
        maxToolRounds: 8,
      },
    );

    expect(begun.ok).toBe(true);
    if (!begun.ok) return;

    const events = await runAndCollect(project.id, begun.run);

    const messages = workspace.listMessages(project.id);
    const last = messages.at(-1);
    expect(last?.role).toBe("assistant");
    expect(last?.content).toBe("已更新 App");
    expect(last?.content).not.toBe(ASSISTANT_PLACEHOLDER);
    expect(last?.process?.steps.some((s) => s.type === "tool")).toBe(true);
    expect(workspace.readFile(project.id, "src/App.tsx")).toContain("App");
    expect(preview.enqueueBuild).toHaveBeenCalledWith(project.id);
    expect(events.some((e) => e.type === "token" && e.text === "已更新 App")).toBe(
      true,
    );
    expect(events.some((e) => e.type === "status" && e.phase === "thinking")).toBe(
      true,
    );
    expect(
      events.some(
        (e) =>
          e.type === "tool" &&
          e.name === "write_file" &&
          e.state === "start" &&
          e.summary === "src/App.tsx",
      ),
    ).toBe(true);
    expect(
      events.some(
        (e) =>
          e.type === "done" &&
          e.filesChanged === true &&
          e.previewEnqueued === true &&
          e.messageId === last?.id,
      ),
    ).toBe(true);
  });

  it("does not put process text into llm history", async () => {
    const thinkingLong =
      "THINKING_LONG_SECRET_" + "x".repeat(200);
    const { project, messages: seeded } = createProject(
      {
        ownerUserId: "demo",
        requirement: "初始需求",
        mode: "engineer",
      },
      workspace,
    );
    const seedAssistant = seeded.find((m) => m.role === "assistant");
    expect(seedAssistant).toBeTruthy();
    workspace.updateMessage(seedAssistant!.id, {
      content: "短回复",
      process: {
        steps: [{ type: "thinking", text: thinkingLong }],
      },
    });

    let capturedMessages:
      | Array<{ role: string; content?: string | null }>
      | undefined;
    const base = llmFromScript([
      [
        { type: "content_delta", text: "下一轮" },
        { type: "finished", finishReason: "stop" },
      ],
    ]);
    const llm: LlmClient = {
      async *complete(input) {
        capturedMessages = input.messages.map((m) => ({
          role: m.role,
          content: "content" in m ? m.content : undefined,
        }));
        yield* base.complete(input);
      },
    };

    const begun = beginEngineerTurn(
      {
        ownerUserId: "demo",
        projectId: project.id,
        action: "send",
        content: "继续",
      },
      {
        workspace,
        preferences: fakePreferences,
        preview: mockPreview(),
        llm,
        agent: createCoderAgent({ systemPrompt: "test" }),
        model: "test-model",
        maxToolRounds: 8,
      },
    );

    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    await begun.run();

    expect(capturedMessages).toBeDefined();
    const joined = (capturedMessages ?? [])
      .map((m) => (typeof m.content === "string" ? m.content : ""))
      .join("\n");
    expect(joined).not.toContain(thinkingLong);
    expect(joined).toContain("短回复");
  });

  it("send appends user + assistant and leaves no placeholder", async () => {
    const { project, messages: seeded } = createProject(
      {
        ownerUserId: "demo",
        requirement: "初始需求",
        mode: "engineer",
      },
      workspace,
    );
    const seedAssistant = seeded.find((m) => m.role === "assistant");
    expect(seedAssistant?.content).toBe(ASSISTANT_PLACEHOLDER);
    workspace.updateMessage(seedAssistant!.id, { content: "先前回复" });

    const before = workspace.listMessages(project.id);
    const preview = mockPreview();
    const begun = beginEngineerTurn(
      {
        ownerUserId: "demo",
        projectId: project.id,
        action: "send",
        content: "再改一下标题",
      },
      {
        workspace,
        preferences: fakePreferences,
        preview,
        llm: llmFromScript([
          [
            { type: "content_delta", text: "好的，已调整" },
            { type: "finished", finishReason: "stop" },
          ],
        ]),
        agent: createCoderAgent({ systemPrompt: "test" }),
        model: "test-model",
        maxToolRounds: 8,
      },
    );

    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    await begun.run();

    const after = workspace.listMessages(project.id);
    expect(after.length - before.length).toBe(2);
    expect(after.at(-2)?.role).toBe("user");
    expect(after.at(-2)?.content).toBe("再改一下标题");
    expect(after.at(-1)?.role).toBe("assistant");
    expect(after.at(-1)?.content).toBe("好的，已调整");
    expect(after.every((m) => m.content !== ASSISTANT_PLACEHOLDER)).toBe(true);
  });

  it("send cancels leftover seed placeholder before appending user", async () => {
    const { project, messages: seeded } = createProject(
      {
        ownerUserId: "demo",
        requirement: "初始需求",
        mode: "engineer",
      },
      workspace,
    );
    expect(
      seeded.some(
        (m) => m.role === "assistant" && m.content === ASSISTANT_PLACEHOLDER,
      ),
    ).toBe(true);

    const begun = beginEngineerTurn(
      {
        ownerUserId: "demo",
        projectId: project.id,
        action: "send",
        content: "直接开聊",
      },
      {
        workspace,
        preferences: fakePreferences,
        preview: mockPreview(),
        llm: llmFromScript([
          [
            { type: "content_delta", text: "收到" },
            { type: "finished", finishReason: "stop" },
          ],
        ]),
        agent: createCoderAgent({ systemPrompt: "test" }),
        model: "test-model",
        maxToolRounds: 8,
      },
    );

    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    await begun.run();

    const after = workspace.listMessages(project.id);
    expect(after.every((m) => m.content !== ASSISTANT_PLACEHOLDER)).toBe(true);
    expect(
      after.some((m) => m.content === "（上一轮待生成已取消）"),
    ).toBe(true);
    expect(after.at(-2)?.role).toBe("user");
    expect(after.at(-2)?.content).toBe("直接开聊");
    expect(after.at(-1)?.content).toBe("收到");
  });

  it("second begin while first run holds lock returns conflict", async () => {
    const { project } = createProject(
      {
        ownerUserId: "demo",
        requirement: "做一个空页面",
        mode: "engineer",
      },
      workspace,
    );
    const preview = mockPreview();
    const deps = {
      workspace,
      preferences: fakePreferences,
      preview,
      llm: llmWithDelay(
        [
          [
            { type: "content_delta", text: "ok" },
            { type: "finished", finishReason: "stop" },
          ],
        ],
        50,
      ),
      agent: createCoderAgent({ systemPrompt: "test" }),
      model: "test-model",
      maxToolRounds: 8,
    };

    const a = beginEngineerTurn(
      {
        ownerUserId: "demo",
        projectId: project.id,
        action: "continue",
      },
      deps,
    );
    const b = beginEngineerTurn(
      {
        ownerUserId: "demo",
        projectId: project.id,
        action: "continue",
      },
      deps,
    );

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(false);
    if (b.ok) return;
    expect(b.status).toBe("conflict");

    if (!a.ok) return;
    await a.run();
  });

  it("llm complete throw emits error and prefixes placeholder with 生成失败：", async () => {
    const { project } = createProject(
      {
        ownerUserId: "demo",
        requirement: "做一个空页面",
        mode: "engineer",
      },
      workspace,
    );
    const preview = mockPreview();

    const begun = beginEngineerTurn(
      {
        ownerUserId: "demo",
        projectId: project.id,
        action: "continue",
      },
      {
        workspace,
        preferences: fakePreferences,
        preview,
        llm: {
          async *complete(_input) {
            throw new Error("upstream down");
          },
        },
        agent: createCoderAgent({ systemPrompt: "test" }),
        model: "test-model",
        maxToolRounds: 8,
      },
    );

    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    const events = await runAndCollect(project.id, begun.run);

    const last = workspace.listMessages(project.id).at(-1);
    expect(last?.content.startsWith("生成失败：")).toBe(true);
    expect(last?.content).toContain("upstream down");
    expect(
      events.some(
        (e) => e.type === "error" && e.message.startsWith("生成失败："),
      ),
    ).toBe(true);
  });

  it("Controller is already closed does not write 生成失败", async () => {
    const { project } = createProject(
      {
        ownerUserId: "demo",
        requirement: "x",
        mode: "engineer",
      },
      workspace,
    );

    const begun = beginEngineerTurn(
      {
        ownerUserId: "demo",
        projectId: project.id,
        action: "continue",
      },
      {
        workspace,
        preferences: fakePreferences,
        preview: mockPreview(),
        llm: {
          async *complete(_input) {
            throw new Error("Invalid state: Controller is already closed");
          },
        },
        agent: createCoderAgent({ systemPrompt: "test" }),
        model: "test-model",
        maxToolRounds: 8,
      },
    );

    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    const events = await runAndCollect(project.id, begun.run);

    const last = workspace.listMessages(project.id).at(-1);
    expect(last?.content).toBe(ASSISTANT_PLACEHOLDER);
    expect(last?.content.startsWith("生成失败")).toBe(false);
    expect(events.some((e) => e.type === "error")).toBe(false);
  });

  it("publish to closed subscriber does not write 生成失败", async () => {
    const { project } = createProject(
      {
        ownerUserId: "demo",
        requirement: "x",
        mode: "engineer",
      },
      workspace,
    );
    const begun = beginEngineerTurn(
      {
        ownerUserId: "demo",
        projectId: project.id,
        action: "continue",
      },
      {
        workspace,
        preferences: fakePreferences,
        preview: mockPreview(),
        llm: llmWithDelay(
          [
            [
              { type: "content_delta", text: "你好" },
              { type: "finished", finishReason: "stop" },
            ],
          ],
          30,
        ),
        agent: createCoderAgent({ systemPrompt: "test" }),
        model: "test-model",
        maxToolRounds: 8,
      },
    );
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;

    subscribeTurn(project.id, () => {
      throw new Error("Invalid state: Controller is already closed");
    });

    await begun.run();

    const last = workspace.listMessages(project.id).at(-1);
    expect(last?.content).toBe("你好");
    expect(last?.content.startsWith("生成失败")).toBe(false);
  });

  it("checkpoints process on tool boundary while placeholder remains", async () => {
    const { project } = createProject(
      {
        ownerUserId: "demo",
        requirement: "x",
        mode: "engineer",
      },
      workspace,
    );
    let resolveGate!: () => void;
    const gate = new Promise<void>((r) => {
      resolveGate = r;
    });
    let toolStarted = false;

    const begun = beginEngineerTurn(
      {
        ownerUserId: "demo",
        projectId: project.id,
        action: "continue",
      },
      {
        workspace,
        preferences: fakePreferences,
        preview: mockPreview(),
        llm: {
          async *complete(_input) {
            if (!toolStarted) {
              toolStarted = true;
              yield {
                type: "tool_calls" as const,
                toolCalls: [
                  {
                    id: "c1",
                    type: "function" as const,
                    function: {
                      name: "list_files",
                      arguments: JSON.stringify({ dir: "." }),
                    },
                  },
                ],
              };
              yield { type: "finished" as const, finishReason: "tool_calls" };
              await gate;
              return;
            }
            yield { type: "content_delta" as const, text: "好了" };
            yield { type: "finished" as const, finishReason: "stop" };
          },
        },
        agent: createCoderAgent({ systemPrompt: "test" }),
        model: "test-model",
        maxToolRounds: 8,
      },
    );
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;

    const running = begun.run();
    // 等到 tool start 落库
    for (let i = 0; i < 50; i++) {
      await delay(10);
      const msg = workspace.listMessages(project.id).at(-1);
      if (msg?.process?.steps.some((s) => s.type === "tool")) break;
    }
    const mid = workspace.listMessages(project.id).at(-1);
    expect(mid?.content).toBe(ASSISTANT_PLACEHOLDER);
    expect(mid?.process?.steps.some((s) => s.type === "tool")).toBe(true);

    resolveGate();
    await running;
  });

  it("blocks write_file while plan clarify gate is open", async () => {
    const { project } = createProject(
      {
        ownerUserId: "demo",
        requirement: "做一个空页面",
        planEnabled: true,
      },
      workspace,
    );
    const before = workspace.readFile(project.id, "src/App.tsx");
    const preview = mockPreview();

    const begun = beginEngineerTurn(
      {
        ownerUserId: "demo",
        projectId: project.id,
        action: "continue",
      },
      {
        workspace,
        preferences: fakePreferences,
        preview,
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
                      content:
                        "export default function App(){return <div>gated</div>}",
                    }),
                  },
                },
              ],
            },
            { type: "finished", finishReason: "tool_calls" },
          ],
          [
            { type: "content_delta", text: "先确认需求" },
            { type: "finished", finishReason: "stop" },
          ],
        ]),
        agent: createCoderAgent({ systemPrompt: "test" }),
        model: "test-model",
        maxToolRounds: 8,
      },
    );

    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    const events = await runAndCollect(project.id, begun.run);

    expect(workspace.readFile(project.id, "src/App.tsx")).toBe(before);
    expect(preview.enqueueBuild).not.toHaveBeenCalled();
    expect(
      events.some(
        (e) =>
          e.type === "tool" &&
          e.name === "write_file" &&
          e.state === "end" &&
          e.ok === false,
      ),
    ).toBe(true);
    expect(
      events.some(
        (e) =>
          e.type === "done" &&
          e.filesChanged === false &&
          e.previewEnqueued === false,
      ),
    ).toBe(true);
  });

  it("silentHandoff does not append user but still runs assistant", async () => {
    const { project, messages: seeded } = createProject(
      {
        ownerUserId: "demo",
        requirement: "初始需求",
        mode: "engineer",
      },
      workspace,
    );
    const seedAssistant = seeded.find((m) => m.role === "assistant");
    workspace.updateMessage(seedAssistant!.id, { content: "先前回复" });
    workspace.updateProjectMeta(project.id, {
      planConfirmed: true,
      confirmedRequirement: "做一款待办应用，支持增删改",
      planEnabled: false,
    });

    const before = workspace.listMessages(project.id);
    let capturedMessages:
      | Array<{ role: string; content?: string | null }>
      | undefined;
    const base = llmFromScript([
      [
        { type: "content_delta", text: "按已确认需求开工" },
        { type: "finished", finishReason: "stop" },
      ],
    ]);
    const llm: LlmClient = {
      async *complete(input) {
        capturedMessages = input.messages.map((m) => ({
          role: m.role,
          content: "content" in m ? m.content : undefined,
        }));
        yield* base.complete(input);
      },
    };

    const begun = beginEngineerTurn(
      {
        ownerUserId: "demo",
        projectId: project.id,
        action: "send",
        silentHandoff: true,
      },
      {
        workspace,
        preferences: fakePreferences,
        preview: mockPreview(),
        llm,
        agent: createCoderAgent({ systemPrompt: "test" }),
        model: "test-model",
        maxToolRounds: 8,
      },
    );

    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    await begun.run();

    const after = workspace.listMessages(project.id);
    expect(after.length - before.length).toBe(1);
    expect(after.at(-1)?.role).toBe("assistant");
    expect(after.at(-1)?.content).toBe("按已确认需求开工");
    expect(after.some((m) => m.content === "做一款待办应用，支持增删改")).toBe(
      false,
    );
    const joined = (capturedMessages ?? [])
      .map((m) => (typeof m.content === "string" ? m.content : ""))
      .join("\n");
    expect(joined).toContain("【记忆】");
    expect(joined).toContain("做一款待办应用，支持增删改");
    expect(joined).not.toContain("【已确认需求】");
  });

  it("silentHandoff without confirmed requirement is bad_request", () => {
    const { project, messages: seeded } = createProject(
      {
        ownerUserId: "demo",
        requirement: "初始需求",
        mode: "engineer",
      },
      workspace,
    );
    workspace.updateMessage(seeded.find((m) => m.role === "assistant")!.id, {
      content: "先前回复",
    });

    const begun = beginEngineerTurn(
      {
        ownerUserId: "demo",
        projectId: project.id,
        action: "send",
        silentHandoff: true,
      },
      {
        workspace,
        preferences: fakePreferences,
        preview: mockPreview(),
        llm: llmFromScript([]),
        agent: createCoderAgent({ systemPrompt: "test" }),
        model: "test-model",
        maxToolRounds: 8,
      },
    );

    expect(begun.ok).toBe(false);
    if (begun.ok) return;
    expect(begun.status).toBe("bad_request");
  });

  it("send creates placeholder early so mid-turn process can persist", async () => {
    const { project } = createProject(
      {
        ownerUserId: "demo",
        requirement: "x",
        mode: "engineer",
      },
      workspace,
    );
    // 清掉 createProject 的占位，模拟用户后续 send
    const seed = workspace.listMessages(project.id).at(-1)!;
    workspace.updateMessage(seed.id, { content: "已完成首轮" });

    let resolveGate!: () => void;
    const gate = new Promise<void>((r) => {
      resolveGate = r;
    });

    const begun = beginEngineerTurn(
      {
        ownerUserId: "demo",
        projectId: project.id,
        action: "send",
        content: "再改一下",
      },
      {
        workspace,
        preferences: fakePreferences,
        preview: mockPreview(),
        llm: {
          async *complete(_input) {
            yield { type: "content_delta" as const, text: "改完" };
            yield { type: "finished" as const, finishReason: "stop" };
            await gate;
          },
        },
        agent: createCoderAgent({ systemPrompt: "test" }),
        model: "test-model",
        maxToolRounds: 8,
      },
    );
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;

    const running = begun.run();
    await delay(20);
    const msgs = workspace.listMessages(project.id);
    const last = msgs.at(-1);
    expect(last?.role).toBe("assistant");
    expect(last?.content).toBe(ASSISTANT_PLACEHOLDER);
    resolveGate();
    await running;
  });

  it("remember_decision appends decisions.md via tool call", async () => {
    const { project } = createProject(
      {
        ownerUserId: "demo",
        requirement: "做一个空页面",
        mode: "engineer",
      },
      workspace,
    );
    const preferences = createPreferenceStore({ dataRoot });

    const begun = beginEngineerTurn(
      {
        ownerUserId: "demo",
        projectId: project.id,
        action: "continue",
      },
      {
        workspace,
        preferences,
        preview: mockPreview(),
        llm: llmFromScript([
          [
            {
              type: "tool_calls",
              toolCalls: [
                {
                  id: "d1",
                  type: "function",
                  function: {
                    name: "remember_decision",
                    arguments: JSON.stringify({ text: "用本地存储" }),
                  },
                },
              ],
            },
            { type: "finished", finishReason: "tool_calls" },
          ],
          [
            { type: "content_delta", text: "已记下决策" },
            { type: "finished", finishReason: "stop" },
          ],
        ]),
        agent: createCoderAgent({ systemPrompt: "test" }),
        model: "test-model",
        maxToolRounds: 8,
      },
    );
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    await begun.run();

    const content = workspace.readFile(project.id, DECISIONS_PATH);
    expect(content).toContain("用本地存储");
  });

  it("set_preference persists via PreferenceStore", async () => {
    const { project } = createProject(
      {
        ownerUserId: "demo",
        requirement: "做一个空页面",
        mode: "engineer",
      },
      workspace,
    );
    const preferences = createPreferenceStore({ dataRoot });

    const begun = beginEngineerTurn(
      {
        ownerUserId: "demo",
        projectId: project.id,
        action: "continue",
      },
      {
        workspace,
        preferences,
        preview: mockPreview(),
        llm: llmFromScript([
          [
            {
              type: "tool_calls",
              toolCalls: [
                {
                  id: "p1",
                  type: "function",
                  function: {
                    name: "set_preference",
                    arguments: JSON.stringify({
                      key: "ui_language",
                      value: "zh",
                    }),
                  },
                },
              ],
            },
            { type: "finished", finishReason: "tool_calls" },
          ],
          [
            { type: "content_delta", text: "已保存偏好" },
            { type: "finished", finishReason: "stop" },
          ],
        ]),
        agent: createCoderAgent({ systemPrompt: "test" }),
        model: "test-model",
        maxToolRounds: 8,
      },
    );
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    await begun.run();

    expect(preferences.getPreferences("demo").ui_language).toBe("zh");
  });

  it("AC2: preference from project 1 injects into project 2 for same user only", async () => {
    const preferences = createPreferenceStore({ dataRoot });

    const { project: project1 } = createProject(
      {
        ownerUserId: "userA",
        requirement: "项目一",
        mode: "engineer",
      },
      workspace,
    );
    const writeBegun = beginEngineerTurn(
      {
        ownerUserId: "userA",
        projectId: project1.id,
        action: "continue",
      },
      {
        workspace,
        preferences,
        preview: mockPreview(),
        llm: llmFromScript([
          [
            {
              type: "tool_calls",
              toolCalls: [
                {
                  id: "p1",
                  type: "function",
                  function: {
                    name: "set_preference",
                    arguments: JSON.stringify({
                      key: "ui_language",
                      value: "zh",
                    }),
                  },
                },
              ],
            },
            { type: "finished", finishReason: "tool_calls" },
          ],
          [
            { type: "content_delta", text: "已保存偏好" },
            { type: "finished", finishReason: "stop" },
          ],
        ]),
        agent: createCoderAgent({ systemPrompt: "test" }),
        model: "test-model",
        maxToolRounds: 8,
      },
    );
    expect(writeBegun.ok).toBe(true);
    if (!writeBegun.ok) return;
    await writeBegun.run();

    const { project: project2 } = createProject(
      {
        ownerUserId: "userA",
        requirement: "项目二",
        mode: "engineer",
      },
      workspace,
    );
    let historyA: Array<{ role: string; content?: string | null }> | undefined;
    const baseA = llmFromScript([
      [
        { type: "content_delta", text: "开工" },
        { type: "finished", finishReason: "stop" },
      ],
    ]);
    const begunA = beginEngineerTurn(
      {
        ownerUserId: "userA",
        projectId: project2.id,
        action: "continue",
      },
      {
        workspace,
        preferences,
        preview: mockPreview(),
        llm: {
          async *complete(input) {
            historyA = input.messages.map((m) => ({
              role: m.role,
              content: "content" in m ? m.content : undefined,
            }));
            yield* baseA.complete(input);
          },
        },
        agent: createCoderAgent({ systemPrompt: "test" }),
        model: "test-model",
        maxToolRounds: 8,
      },
    );
    expect(begunA.ok).toBe(true);
    if (!begunA.ok) return;
    await begunA.run();

    const memoryA = historyA?.find(
      (m) => typeof m.content === "string" && m.content.startsWith("【记忆】"),
    );
    expect(memoryA?.content).toContain("ui_language: zh");

    const { project: projectB } = createProject(
      {
        ownerUserId: "userB",
        requirement: "别人的项目",
        mode: "engineer",
      },
      workspace,
    );
    let historyB: Array<{ role: string; content?: string | null }> | undefined;
    const baseB = llmFromScript([
      [
        { type: "content_delta", text: "开工" },
        { type: "finished", finishReason: "stop" },
      ],
    ]);
    const begunB = beginEngineerTurn(
      {
        ownerUserId: "userB",
        projectId: projectB.id,
        action: "continue",
      },
      {
        workspace,
        preferences,
        preview: mockPreview(),
        llm: {
          async *complete(input) {
            historyB = input.messages.map((m) => ({
              role: m.role,
              content: "content" in m ? m.content : undefined,
            }));
            yield* baseB.complete(input);
          },
        },
        agent: createCoderAgent({ systemPrompt: "test" }),
        model: "test-model",
        maxToolRounds: 8,
      },
    );
    expect(begunB.ok).toBe(true);
    if (!begunB.ok) return;
    await begunB.run();

    const joinedB = (historyB ?? [])
      .map((m) => m.content ?? "")
      .join("\n");
    expect(joinedB).not.toContain("ui_language: zh");
  });
});
