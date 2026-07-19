import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCoderAgent,
  createLeaderAgent,
  createQaAgent,
} from "@isotope/agents";
import type { LlmClient, LlmStreamEvent } from "@isotope/llm";
import type { PreferenceStore } from "@isotope/memory";
import type { PreviewService, PreviewStatusSnapshot } from "@isotope/preview";
import { createFsSqliteWorkspace } from "@isotope/workspace";
import { createProject } from "./create-project.js";
import { ASSISTANT_PLACEHOLDER } from "./placeholder.js";
import { DECISIONS_PATH } from "./project-memory-paths.js";
import { createTaskEventBus } from "./task-event-bus.js";
import {
  beginTeamTurn,
  retryStuckAssignedTask,
  type TeamTurnEvent,
} from "./stream-team-turn.js";
import { isTurnHubActive, subscribeTurn } from "./turn-hub.js";
import { releaseTurnLock, tryAcquireTurnLock } from "./turn-lock.js";

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

const DEFAULT_WRITE_POLICY = { allow: ["src/**", "index.html"] };

function teamExtras(overrides: {
  runTypecheck?: (projectId: string) => Promise<{ ok: boolean; log: string }>;
} = {}) {
  return {
    writePolicy: DEFAULT_WRITE_POLICY,
    qa: createQaAgent({ systemPrompt: "test-qa" }),
    qaModel: "test-qa-model",
    runTypecheck:
      overrides.runTypecheck ??
      (async () => ({ ok: true as const, log: "" })),
  };
}

function isQaTools(
  tools: Array<{ function: { name: string } }> | undefined,
): boolean {
  return !!tools?.some((t) => t.function.name === "run_check");
}

/** QA rounds auto-call run_check then emit PASS/FAIL report text. */
function withAutoQa(
  base: LlmClient,
  outcome: "pass" | "fail",
): LlmClient {
  let awaitingReport = false;
  const report =
    outcome === "pass"
      ? "【质检结果】PASS\n检查：typecheck\n问题：无"
      : "【质检结果】FAIL\n检查：typecheck\n问题：still broken";
  return {
    async *complete(input) {
      if (isQaTools(input.tools)) {
        if (!awaitingReport) {
          awaitingReport = true;
          yield {
            type: "tool_calls" as const,
            toolCalls: [
              {
                id: "qa-check",
                type: "function" as const,
                function: { name: "run_check", arguments: "{}" },
              },
            ],
          };
          yield { type: "finished" as const, finishReason: "tool_calls" };
          return;
        }
        awaitingReport = false;
        yield { type: "content_delta" as const, text: report };
        yield { type: "finished" as const, finishReason: "stop" };
        return;
      }
      yield* base.complete(input);
    },
  };
}

function teamDeps(
  workspace: ReturnType<typeof createFsSqliteWorkspace>,
  llm: LlmClient,
  preview: PreviewService = mockPreview(),
  extras: ReturnType<typeof teamExtras> = teamExtras(),
) {
  return {
    workspace,
    preferences: fakePreferences,
    preview,
    llm,
    leader: createLeaderAgent({ systemPrompt: "mike-test" }),
    leaderModel: "test-model",
    leaderSummary: createLeaderAgent({ systemPrompt: "sum", tools: [] }),
    leaderSummaryModel: "test-model",
    coder: createCoderAgent({ systemPrompt: "alex-test" }),
    coderModel: "test-model",
    bus: createTaskEventBus(),
    maxToolRounds: 8,
    ...extras,
  };
}

const mikeAssignRounds: LlmStreamEvent[][] = [
  [
    {
      type: "tool_calls",
      toolCalls: [
        {
          id: "c1",
          type: "function",
          function: {
            name: "create_task",
            arguments: JSON.stringify({
              title: "统一文案",
              assignee: "Alex",
            }),
          },
        },
      ],
    },
    { type: "finished", finishReason: "tool_calls" },
  ],
  [
    { type: "content_delta", text: "已指派给 Alex" },
    { type: "finished", finishReason: "stop" },
  ],
];

const alexWriteRounds: LlmStreamEvent[][] = [
  [
    {
      type: "tool_calls",
      toolCalls: [
        {
          id: "w1",
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
    { type: "content_delta", text: "标题已更新" },
    { type: "finished", finishReason: "stop" },
  ],
];

async function runAndCollect(
  projectId: string,
  run: () => Promise<void>,
): Promise<TeamTurnEvent[]> {
  const events: TeamTurnEvent[] = [];
  const unsub = subscribeTurn(projectId, (e) =>
    events.push(e as TeamTurnEvent),
  );
  await run();
  unsub?.();
  return events;
}

const happyPathRounds: LlmStreamEvent[][] = [
  [
    {
      type: "tool_calls",
      toolCalls: [
        {
          id: "c1",
          type: "function",
          function: {
            name: "create_task",
            arguments: JSON.stringify({
              title: "统一文案",
              assignee: "Alex",
            }),
          },
        },
      ],
    },
    { type: "finished", finishReason: "tool_calls" },
  ],
  [
    { type: "content_delta", text: "已指派给 Alex" },
    { type: "finished", finishReason: "stop" },
  ],
  [
    { type: "content_delta", text: "标题已更新" },
    { type: "finished", finishReason: "stop" },
  ],
  [
    { type: "content_delta", text: "本轮任务已全部完成，标题已按要求更新。" },
    { type: "finished", finishReason: "stop" },
  ],
];

describe("beginTeamTurn", () => {
  let dataRoot: string;
  let workspace: ReturnType<typeof createFsSqliteWorkspace>;

  beforeEach(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "iso-app-team-"));
    workspace = createFsSqliteWorkspace({ dataRoot, templatePath });
  });

  afterEach(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  it("send: Mike create_task then Alex completes task with speakers and done.taskId", async () => {
    const { project, messages: seeded } = createProject(
      {
        ownerUserId: "demo",
        requirement: "统一文案",
        mode: "team",
      },
      workspace,
    );
    const seedAssistant = seeded.find((m) => m.role === "assistant");
    expect(seedAssistant?.agentName).toBe("Mike");
    workspace.updateMessage(seedAssistant!.id, { content: "先前规划" });

    const preview = mockPreview();
    const begun = beginTeamTurn(
      {
        ownerUserId: "demo",
        projectId: project.id,
        action: "send",
        content: "请改首页标题",
      },
      teamDeps(workspace, llmFromScript(happyPathRounds), preview),
    );

    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    const events = await runAndCollect(project.id, begun.run);

    const speakers = events.filter((e) => e.type === "speaker");
    expect(speakers).toHaveLength(3);
    expect(speakers[0]).toMatchObject({ agentName: "Mike" });
    expect(speakers[1]).toMatchObject({ agentName: "Alex" });
    expect(speakers[2]).toMatchObject({ agentName: "Mike" });

    const taskEvents = events.filter((e) => e.type === "task");
    expect(taskEvents.some((e) => e.type === "task" && e.status === "assigned")).toBe(
      true,
    );
    expect(taskEvents.some((e) => e.type === "task" && e.status === "running")).toBe(
      true,
    );
    expect(
      taskEvents.some((e) => e.type === "task" && e.status === "completed"),
    ).toBe(true);

    const tasks = workspace.listTasks(project.id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.status).toBe("completed");
    expect(tasks[0]?.title).toBe("统一文案");

    const done = events.find((e) => e.type === "done");
    expect(done).toMatchObject({
      type: "done",
      taskId: tasks[0]?.id,
      filesChanged: false,
      previewEnqueued: false,
    });

    const after = workspace.listMessages(project.id);
    expect(after.at(-1)?.agentName).toBe("Mike");
    expect(after.at(-1)?.content).toBe(
      "本轮任务已全部完成，标题已按要求更新。",
    );
    expect(
      after.some((m) => m.agentName === "Mike" && m.content === "已指派给 Alex"),
    ).toBe(true);
    expect(
      after.some((m) => m.agentName === "Alex" && m.content === "标题已更新"),
    ).toBe(true);
  });

  it("silentHandoff does not append user but still runs assistant", async () => {
    const { project, messages: seeded } = createProject(
      {
        ownerUserId: "demo",
        requirement: "统一文案",
        mode: "team",
      },
      workspace,
    );
    const seedAssistant = seeded.find((m) => m.role === "assistant");
    workspace.updateMessage(seedAssistant!.id, { content: "先前规划" });
    workspace.updateProjectMeta(project.id, {
      planConfirmed: true,
      confirmedRequirement: "摘要X",
      planEnabled: false,
      teamEnabled: true,
    });

    const before = workspace.listMessages(project.id);
    const beforeUserCount = before.filter((m) => m.role === "user").length;
    const lastUserBefore = before.filter((m) => m.role === "user").at(-1);

    const begun = beginTeamTurn(
      {
        ownerUserId: "demo",
        projectId: project.id,
        action: "send",
        silentHandoff: true,
      },
      teamDeps(workspace, llmFromScript(happyPathRounds)),
    );

    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    const events = await runAndCollect(project.id, begun.run);

    const after = workspace.listMessages(project.id);
    const afterUsers = after.filter((m) => m.role === "user");
    expect(afterUsers).toHaveLength(beforeUserCount);
    expect(afterUsers.at(-1)?.content).toBe(lastUserBefore?.content);
    expect(after.some((m) => m.content === "摘要X")).toBe(false);

    expect(events.some((e) => e.type === "done")).toBe(true);
    expect(after.length).toBeGreaterThan(before.length);
    expect(after.at(-1)?.role).toBe("assistant");
  });

  it("errors when Mike does not create_task and never starts Alex", async () => {
    const { project } = createProject(
      {
        ownerUserId: "demo",
        requirement: "统一文案",
        mode: "team",
      },
      workspace,
    );
    const begun = beginTeamTurn(
      {
        ownerUserId: "demo",
        projectId: project.id,
        action: "continue",
      },
      teamDeps(
        workspace,
        llmFromScript([
          [
            { type: "content_delta", text: "我先问问需求" },
            { type: "finished", finishReason: "stop" },
          ],
        ]),
      ),
    );

    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    const events = await runAndCollect(project.id, begun.run);

    expect(events.some((e) => e.type === "speaker" && e.agentName === "Mike")).toBe(
      true,
    );
    expect(events.some((e) => e.type === "speaker" && e.agentName === "Alex")).toBe(
      false,
    );
    expect(events.some((e) => e.type === "error")).toBe(true);
    expect(workspace.listTasks(project.id)).toHaveLength(0);
    expect(events.some((e) => e.type === "done")).toBe(false);
  });

  it("Alex failure emits task status failed when a task exists", async () => {
    const { project, messages: seeded } = createProject(
      {
        ownerUserId: "demo",
        requirement: "统一文案",
        mode: "team",
      },
      workspace,
    );
    const seedAssistant = seeded.find((m) => m.role === "assistant");
    workspace.updateMessage(seedAssistant!.id, { content: "先前规划" });

    let round = 0;
    const llm: LlmClient = {
      async *complete(_input) {
        round += 1;
        if (round === 1) {
          yield {
            type: "tool_calls",
            toolCalls: [
              {
                id: "c1",
                type: "function",
                function: {
                  name: "create_task",
                  arguments: JSON.stringify({
                    title: "统一文案",
                    assignee: "Alex",
                  }),
                },
              },
            ],
          };
          yield { type: "finished", finishReason: "tool_calls" };
          return;
        }
        if (round === 2) {
          yield { type: "content_delta", text: "已指派给 Alex" };
          yield { type: "finished", finishReason: "stop" };
          return;
        }
        throw new Error("alex boom");
      },
    };

    const begun = beginTeamTurn(
      {
        ownerUserId: "demo",
        projectId: project.id,
        action: "send",
        content: "请改首页标题",
      },
      teamDeps(workspace, llm),
    );

    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    const events = await runAndCollect(project.id, begun.run);

    expect(
      events.some((e) => e.type === "task" && e.status === "failed"),
    ).toBe(true);
    expect(workspace.listTasks(project.id)[0]?.status).toBe("failed");
    expect(
      events.some(
        (e) => e.type === "error" && e.message.startsWith("生成失败："),
      ),
    ).toBe(true);
    const alexMsg = workspace
      .listMessages(project.id)
      .find((m) => m.agentName === "Alex");
    expect(alexMsg?.content.startsWith("生成失败：")).toBe(true);
  });

  it("continue Mike failure replaces placeholder content", async () => {
    const { project } = createProject(
      {
        ownerUserId: "demo",
        requirement: "统一文案",
        mode: "team",
      },
      workspace,
    );
    const begun = beginTeamTurn(
      {
        ownerUserId: "demo",
        projectId: project.id,
        action: "continue",
      },
      teamDeps(workspace, {
        async *complete(_input) {
          throw new Error("mike boom");
        },
      }),
    );

    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    const events = await runAndCollect(project.id, begun.run);

    const last = workspace.listMessages(project.id).at(-1);
    expect(last?.agentName).toBe("Mike");
    expect(last?.content).not.toBe(ASSISTANT_PLACEHOLDER);
    expect(last?.content.startsWith("生成失败：")).toBe(true);
    expect(last?.content).toContain("mike boom");
    expect(
      events.some(
        (e) => e.type === "error" && e.message.startsWith("生成失败："),
      ),
    ).toBe(true);
    expect(workspace.listTasks(project.id)).toHaveLength(0);
  });

  it("second begin while active returns conflict; subscribe gets events without second task", async () => {
    const { project, messages: seeded } = createProject(
      {
        ownerUserId: "demo",
        requirement: "统一文案",
        mode: "team",
      },
      workspace,
    );
    const seedAssistant = seeded.find((m) => m.role === "assistant");
    workspace.updateMessage(seedAssistant!.id, { content: "先前规划" });

    const deps = teamDeps(workspace, llmWithDelay(happyPathRounds, 40));

    const first = beginTeamTurn(
      {
        ownerUserId: "demo",
        projectId: project.id,
        action: "send",
        content: "请改首页标题",
      },
      deps,
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(isTurnHubActive(project.id)).toBe(true);

    const second = beginTeamTurn(
      {
        ownerUserId: "demo",
        projectId: project.id,
        action: "send",
        content: "重连误开第二轮",
      },
      deps,
    );
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.status).toBe("conflict");

    // 模拟重连：只 subscribe，不再 begin
    const events: TeamTurnEvent[] = [];
    const unsub = subscribeTurn(project.id, (e) =>
      events.push(e as TeamTurnEvent),
    );
    expect(unsub).not.toBeNull();

    await first.run();
    unsub?.();

    expect(events.some((e) => e.type === "speaker")).toBe(true);
    expect(events.some((e) => e.type === "done")).toBe(true);
    expect(workspace.listTasks(project.id)).toHaveLength(1);
    expect(isTurnHubActive(project.id)).toBe(false);
  });

  it("throwing subscriber does not mark task failed or 生成失败 on mike", async () => {
    const { project, messages: seeded } = createProject(
      {
        ownerUserId: "demo",
        requirement: "统一文案",
        mode: "team",
      },
      workspace,
    );
    const seedAssistant = seeded.find((m) => m.role === "assistant");
    workspace.updateMessage(seedAssistant!.id, { content: "先前规划" });

    const begun = beginTeamTurn(
      {
        ownerUserId: "demo",
        projectId: project.id,
        action: "send",
        content: "请改首页标题",
      },
      teamDeps(workspace, llmFromScript(happyPathRounds)),
    );
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;

    subscribeTurn(project.id, () => {
      throw new Error("Invalid state: Controller is already closed");
    });

    await begun.run();

    const tasks = workspace.listTasks(project.id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.status).toBe("completed");

    const mikeMsgs = workspace
      .listMessages(project.id)
      .filter((m) => m.agentName === "Mike");
    expect(
      mikeMsgs.every((m) => !m.content.includes("生成失败")),
    ).toBe(true);
    const alexMsg = workspace
      .listMessages(project.id)
      .find((m) => m.agentName === "Alex");
    expect(alexMsg?.content).toBe("标题已更新");
  });

  it("retryStuckAssignedTask runs Alex and completes the task", async () => {
    const { project } = createProject(
      {
        ownerUserId: "demo",
        requirement: "统一文案",
        mode: "team",
      },
      workspace,
    );
    const mike = workspace.appendMessage({
      projectId: project.id,
      role: "assistant",
      content: "拆好了",
      agentName: "Mike",
    });
    const task = workspace.createTask({
      projectId: project.id,
      title: "改标题",
      assignee: "Alex",
      status: "assigned",
      createdByMessageId: mike.id,
    });

    const deps = teamDeps(
      workspace,
      llmFromScript([
        [
          { type: "content_delta", text: "已改好" },
          { type: "finished", finishReason: "stop" },
        ],
        [
          { type: "content_delta", text: "任务已完成，可以继续提需求。" },
          { type: "finished", finishReason: "stop" },
        ],
      ]),
    );

    const result = await retryStuckAssignedTask(task, deps);
    expect(result.ok).toBe(true);

    const updated = workspace.getTask(task.id);
    expect(updated?.status).toBe("completed");
    expect(updated?.assigneeMessageId).toBeTruthy();
    const alexMsg = workspace
      .listMessages(project.id)
      .find((m) => m.id === updated?.assigneeMessageId);
    expect(alexMsg?.agentName).toBe("Alex");
    expect(alexMsg?.content).toBe("已改好");
    const last = workspace.listMessages(project.id).at(-1);
    expect(last?.agentName).toBe("Mike");
    expect(last?.content).toBe("任务已完成，可以继续提需求。");
  });

  it("retryStuckAssignedTask conflict advances lastProgressAt", async () => {
    const { project } = createProject(
      {
        ownerUserId: "demo",
        requirement: "统一文案",
        mode: "team",
      },
      workspace,
    );
    const mike = workspace.appendMessage({
      projectId: project.id,
      role: "assistant",
      content: "拆好了",
      agentName: "Mike",
    });
    const task = workspace.createTask({
      projectId: project.id,
      title: "改标题",
      assignee: "Alex",
      status: "assigned",
      createdByMessageId: mike.id,
    });
    const stuckAt = new Date(Date.now() - 120_000).toISOString();
    workspace.updateTask(task.id, { lastProgressAt: stuckAt });
    expect(tryAcquireTurnLock(project.id)).toBe(true);

    const deps = teamDeps(workspace, llmFromScript([]));
    const result = await retryStuckAssignedTask(task, deps);

    expect(result).toEqual({ ok: false, error: "conflict" });
    const updated = workspace.getTask(task.id);
    expect(updated?.status).toBe("assigned");
    expect(new Date(updated!.lastProgressAt).getTime()).toBeGreaterThan(
      new Date(stuckAt).getTime(),
    );
    releaseTurnLock(project.id);
  });

  it("QA PASS after Alex writes enqueues preview and may run Mike summary", async () => {
    const { project, messages: seeded } = createProject(
      {
        ownerUserId: "demo",
        requirement: "统一文案",
        mode: "team",
      },
      workspace,
    );
    workspace.updateMessage(seeded.find((m) => m.role === "assistant")!.id, {
      content: "先前规划",
    });

    const preview = mockPreview();
    const rounds: LlmStreamEvent[][] = [
      ...mikeAssignRounds,
      ...alexWriteRounds,
      [
        { type: "content_delta", text: "本轮任务已全部完成，标题已按要求更新。" },
        { type: "finished", finishReason: "stop" },
      ],
    ];

    const begun = beginTeamTurn(
      {
        ownerUserId: "demo",
        projectId: project.id,
        action: "send",
        content: "请改首页标题",
      },
      teamDeps(workspace, withAutoQa(llmFromScript(rounds), "pass"), preview),
    );

    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    const events = await runAndCollect(project.id, begun.run);

    expect(preview.enqueueBuild).toHaveBeenCalledTimes(1);
    expect(
      events.some(
        (e) =>
          e.type === "done" &&
          e.filesChanged === true &&
          e.previewEnqueued === true,
      ),
    ).toBe(true);
    expect(
      events.some((e) => e.type === "speaker" && e.agentName === "QA"),
    ).toBe(true);
    expect(workspace.listMessages(project.id).at(-1)?.agentName).toBe("Mike");
    expect(workspace.listMessages(project.id).at(-1)?.content).toBe(
      "本轮任务已全部完成，标题已按要求更新。",
    );
  });

  it("QA FAIL through max repairs skips Mike summary and preview", async () => {
    const { project, messages: seeded } = createProject(
      {
        ownerUserId: "demo",
        requirement: "统一文案",
        mode: "team",
      },
      workspace,
    );
    workspace.updateMessage(seeded.find((m) => m.role === "assistant")!.id, {
      content: "先前规划",
    });

    const preview = mockPreview();
    const rounds: LlmStreamEvent[][] = [
      ...mikeAssignRounds,
      ...alexWriteRounds,
    ];

    const begun = beginTeamTurn(
      {
        ownerUserId: "demo",
        projectId: project.id,
        action: "send",
        content: "请改首页标题",
      },
      teamDeps(
        workspace,
        withAutoQa(llmFromScript(rounds), "fail"),
        preview,
        teamExtras({
          runTypecheck: async () => ({ ok: false, log: "error TS" }),
        }),
      ),
    );

    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    const events = await runAndCollect(project.id, begun.run);

    expect(preview.enqueueBuild).not.toHaveBeenCalled();
    expect(
      events.some(
        (e) =>
          e.type === "done" &&
          e.filesChanged === true &&
          e.previewEnqueued === false,
      ),
    ).toBe(true);

    const speakers = events.filter((e) => e.type === "speaker");
    expect(speakers.some((e) => e.type === "speaker" && e.agentName === "QA")).toBe(
      true,
    );
    expect(speakers.at(-1)).toMatchObject({ agentName: "QA" });

    const after = workspace.listMessages(project.id);
    expect(after.at(-1)?.agentName).toBe("QA");
    const mikeMsgs = after.filter((m) => m.agentName === "Mike");
    expect(mikeMsgs.some((m) => m.content === "已指派给 Alex")).toBe(true);
    expect(
      mikeMsgs.every(
        (m) =>
          m.content === "先前规划" || m.content === "已指派给 Alex",
      ),
    ).toBe(true);

    const qaMessages = after.filter((m) => m.agentName === "QA");
    expect(qaMessages.length).toBeGreaterThanOrEqual(3);
    expect(qaMessages.at(-1)?.content).toContain("【质检结果】FAIL");
  });

  it("Alex remember_decision appends decisions.md", async () => {
    const { project, messages: seeded } = createProject(
      {
        ownerUserId: "demo",
        requirement: "统一文案",
        mode: "team",
      },
      workspace,
    );
    workspace.updateMessage(seeded.find((m) => m.role === "assistant")!.id, {
      content: "先前规划",
    });

    const rounds: LlmStreamEvent[][] = [
      [
        {
          type: "tool_calls",
          toolCalls: [
            {
              id: "c1",
              type: "function",
              function: {
                name: "create_task",
                arguments: JSON.stringify({
                  title: "改标题",
                  assignee: "Alex",
                }),
              },
            },
          ],
        },
        { type: "finished", finishReason: "tool_calls" },
      ],
      [
        { type: "content_delta", text: "已指派给 Alex" },
        { type: "finished", finishReason: "stop" },
      ],
      [
        {
          type: "tool_calls",
          toolCalls: [
            {
              id: "d1",
              type: "function",
              function: {
                name: "remember_decision",
                arguments: JSON.stringify({ text: "标题用中文" }),
              },
            },
          ],
        },
        { type: "finished", finishReason: "tool_calls" },
      ],
      [
        { type: "content_delta", text: "标题已更新" },
        { type: "finished", finishReason: "stop" },
      ],
      [
        { type: "content_delta", text: "本轮任务已完成。" },
        { type: "finished", finishReason: "stop" },
      ],
    ];

    const begun = beginTeamTurn(
      {
        ownerUserId: "demo",
        projectId: project.id,
        action: "send",
        content: "请改首页标题",
      },
      teamDeps(workspace, llmFromScript(rounds)),
    );
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    await begun.run();

    expect(workspace.readFile(project.id, DECISIONS_PATH)).toContain(
      "标题用中文",
    );
  });

  it("retryStuckAssignedTask failure advances lastProgressAt", async () => {
    const { project } = createProject(
      {
        ownerUserId: "demo",
        requirement: "统一文案",
        mode: "team",
      },
      workspace,
    );
    const mike = workspace.appendMessage({
      projectId: project.id,
      role: "assistant",
      content: "拆好了",
      agentName: "Mike",
    });
    const task = workspace.createTask({
      projectId: project.id,
      title: "改标题",
      assignee: "Alex",
      status: "assigned",
      createdByMessageId: mike.id,
    });
    const stuckAt = new Date(Date.now() - 120_000).toISOString();
    workspace.updateTask(task.id, { lastProgressAt: stuckAt });

    const deps = teamDeps(workspace, {
      async *complete(_input) {
        throw new Error("alex boom");
      },
    });

    const result = await retryStuckAssignedTask(task, deps);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("alex boom");

    const updated = workspace.getTask(task.id);
    expect(new Date(updated!.lastProgressAt).getTime()).toBeGreaterThan(
      new Date(stuckAt).getTime(),
    );
  });
});
