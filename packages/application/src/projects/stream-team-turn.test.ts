import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCoderAgent, createLeaderAgent } from "@isotope/agents";
import type { LlmClient, LlmStreamEvent } from "@isotope/llm";
import type { PreviewService, PreviewStatusSnapshot } from "@isotope/preview";
import { createFsSqliteWorkspace } from "@isotope/workspace";
import { createProject } from "./create-project.js";
import { ASSISTANT_PLACEHOLDER } from "./placeholder.js";
import { createTaskEventBus } from "./task-event-bus.js";
import {
  beginTeamTurn,
  retryStuckAssignedTask,
  type TeamTurnEvent,
} from "./stream-team-turn.js";

const templatePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../templates/vite-react",
);

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
    async *complete() {
      const events = rounds[i++] ?? [
        { type: "finished", finishReason: "stop" } as const,
      ];
      for (const ev of events) yield ev;
    },
  };
}

function teamDeps(
  workspace: ReturnType<typeof createFsSqliteWorkspace>,
  llm: LlmClient,
  preview: PreviewService = mockPreview(),
) {
  return {
    workspace,
    preview,
    llm,
    leader: createLeaderAgent({ systemPrompt: "mike-test" }),
    coder: createCoderAgent({ systemPrompt: "alex-test" }),
    bus: createTaskEventBus(),
    maxToolRounds: 8,
  };
}

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
    const events: TeamTurnEvent[] = [];
    const begun = beginTeamTurn(
      {
        ownerUserId: "demo",
        projectId: project.id,
        action: "send",
        content: "请改首页标题",
      },
      teamDeps(
        workspace,
        llmFromScript([
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
        ]),
        preview,
      ),
    );

    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    await begun.run((ev) => events.push(ev));

    const speakers = events.filter((e) => e.type === "speaker");
    expect(speakers).toHaveLength(2);
    expect(speakers[0]).toMatchObject({ agentName: "Mike" });
    expect(speakers[1]).toMatchObject({ agentName: "Alex" });

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
    expect(after.at(-1)?.agentName).toBe("Alex");
    expect(after.at(-1)?.content).toBe("标题已更新");
    expect(
      after.some((m) => m.agentName === "Mike" && m.content === "已指派给 Alex"),
    ).toBe(true);
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
    const events: TeamTurnEvent[] = [];
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
    await begun.run((ev) => events.push(ev));

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

    const events: TeamTurnEvent[] = [];
    let round = 0;
    const llm: LlmClient = {
      async *complete() {
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
    await begun.run((ev) => events.push(ev));

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
    const events: TeamTurnEvent[] = [];
    const begun = beginTeamTurn(
      {
        ownerUserId: "demo",
        projectId: project.id,
        action: "continue",
      },
      teamDeps(workspace, {
        async *complete() {
          throw new Error("mike boom");
        },
      }),
    );

    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    await begun.run((ev) => events.push(ev));

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
  });
});
