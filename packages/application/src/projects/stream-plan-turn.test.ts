import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCoderAgent,
  createQaAgent,
  createRequirementAgent,
} from "@isotope/agents";
import type { LlmClient, LlmStreamEvent } from "@isotope/llm";
import type { PreferenceStore } from "@isotope/memory";
import type { PreviewService, PreviewStatusSnapshot } from "@isotope/preview";
import { createFsSqliteWorkspace } from "@isotope/workspace";
import { createProject } from "./create-project.js";
import { ASSISTANT_PLACEHOLDER } from "./placeholder.js";
import { PRODUCT_SPEC_PATH } from "./project-memory-paths.js";
import { beginEngineerTurn } from "./stream-engineer-turn.js";
import {
  beginPlanTurn,
  type PlanTurnEvent,
} from "./stream-plan-turn.js";
import { subscribeTurn } from "./turn-hub.js";

const fakePreferences: PreferenceStore = {
  getPreferences: () => ({}),
  upsertPreference: () => {},
};

function readySnapshot(): PreviewStatusSnapshot {
  return {
    status: "ready",
    revision: "rev-1",
    error: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function mockPreview(): PreviewService {
  return {
    getStatus: vi.fn(() => readySnapshot()),
    ensureBuild: vi.fn(() => readySnapshot()),
    enqueueBuild: vi.fn(() => readySnapshot()),
    readAsset: vi.fn(() => null),
  };
}

const templatePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../templates/vite-react",
);

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

async function runAndCollect(
  projectId: string,
  run: () => Promise<void>,
): Promise<PlanTurnEvent[]> {
  const events: PlanTurnEvent[] = [];
  const unsub = subscribeTurn(projectId, (e) =>
    events.push(e as PlanTurnEvent),
  );
  await run();
  unsub?.();
  return events;
}

function enablePlan(
  workspace: ReturnType<typeof createFsSqliteWorkspace>,
  projectId: string,
  flags: { teamEnabled?: boolean } = {},
) {
  workspace.updateProjectMeta(projectId, {
    planEnabled: true,
    ...flags,
  });
}

describe("beginPlanTurn", () => {
  let dataRoot: string;
  let workspace: ReturnType<typeof createFsSqliteWorkspace>;

  beforeEach(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "iso-app-plan-turn-"));
    workspace = createFsSqliteWorkspace({ dataRoot, templatePath });
  });

  afterEach(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  it("continue replaces Pat placeholder; done has no planConfirmed", async () => {
    const { project } = createProject(
      {
        ownerUserId: "demo",
        requirement: "做一个待办应用",
        mode: "engineer",
      },
      workspace,
    );
    enablePlan(workspace, project.id);

    const begun = beginPlanTurn(
      {
        ownerUserId: "demo",
        projectId: project.id,
        action: "continue",
      },
      {
        workspace,
        preferences: fakePreferences,
        llm: llmFromScript([
          [
            { type: "content_delta", text: "先确认一下目标用户？" },
            { type: "finished", finishReason: "stop" },
          ],
        ]),
        agent: createRequirementAgent({ systemPrompt: "test" }),
        model: "test-model",
        maxToolRounds: 8,
      },
    );

    expect(begun.ok).toBe(true);
    if (!begun.ok) return;

    const events = await runAndCollect(project.id, begun.run);

    const last = workspace.listMessages(project.id).at(-1);
    expect(last?.role).toBe("assistant");
    expect(last?.content).toBe("先确认一下目标用户？");
    expect(last?.content).not.toBe(ASSISTANT_PLACEHOLDER);

    const done = events.find((e) => e.type === "done");
    expect(done).toMatchObject({
      type: "done",
      messageId: last?.id,
      filesChanged: false,
      previewEnqueued: false,
    });
    expect(done && "planConfirmed" in done ? done.planConfirmed : undefined).toBe(
      undefined,
    );
    expect(done && "nextTurn" in done ? done.nextTurn : undefined).toBe(
      undefined,
    );
  });

  it("send + confirm_requirement closes plan and reports nextTurn", async () => {
    const { project, messages: seeded } = createProject(
      {
        ownerUserId: "demo",
        requirement: "做一个待办应用",
        mode: "engineer",
      },
      workspace,
    );
    enablePlan(workspace, project.id, { teamEnabled: false });
    const seedAssistant = seeded.find((m) => m.role === "assistant");
    expect(seedAssistant).toBeTruthy();
    workspace.updateMessage(seedAssistant!.id, { content: "先聊聊需求" });

    const summary = "  待办应用：增删改查 + 本地存储  ";
    const begun = beginPlanTurn(
      {
        ownerUserId: "demo",
        projectId: project.id,
        action: "send",
        content: "就按这个做吧",
      },
      {
        workspace,
        preferences: fakePreferences,
        llm: llmFromScript([
          [
            {
              type: "tool_calls",
              toolCalls: [
                {
                  id: "c1",
                  type: "function",
                  function: {
                    name: "confirm_requirement",
                    arguments: JSON.stringify({ summary }),
                  },
                },
              ],
            },
            { type: "finished", finishReason: "tool_calls" },
          ],
          [
            { type: "content_delta", text: "已确认需求，接下来交给实现。" },
            { type: "finished", finishReason: "stop" },
          ],
        ]),
        agent: createRequirementAgent({ systemPrompt: "test" }),
        model: "test-model",
        maxToolRounds: 8,
      },
    );

    expect(begun.ok).toBe(true);
    if (!begun.ok) return;

    const events = await runAndCollect(project.id, begun.run);

    const again = workspace.getProject(project.id)!;
    expect(again.planEnabled).toBe(false);
    expect(again.planConfirmed).toBe(true);
    expect(again.confirmedRequirement).toBe(summary.trim());
    expect(workspace.readFile(project.id, PRODUCT_SPEC_PATH)).toContain(
      summary.trim(),
    );

    const last = workspace.listMessages(project.id).at(-1);
    expect(last?.content).toBe("已确认需求，接下来交给实现。");
    expect(last?.agentName).toBe("Pat");

    expect(
      events.some(
        (e) =>
          e.type === "done" &&
          e.filesChanged === false &&
          e.previewEnqueued === false &&
          e.planConfirmed === true &&
          e.nextTurn === "engineer" &&
          e.messageId === last?.id,
      ),
    ).toBe(true);

    let capturedMessages:
      | Array<{ role: string; content?: string | null }>
      | undefined;
    const handoffBase = llmFromScript([
      [
        { type: "content_delta", text: "按规格开工" },
        { type: "finished", finishReason: "stop" },
      ],
    ]);
    const handoffLlm: LlmClient = {
      async *complete(input) {
        capturedMessages = input.messages.map((m) => ({
          role: m.role,
          content: "content" in m ? m.content : undefined,
        }));
        yield* handoffBase.complete(input);
      },
    };
    const handoff = beginEngineerTurn(
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
        llm: handoffLlm,
        agent: createCoderAgent({ systemPrompt: "test" }),
        model: "test-model",
        maxToolRounds: 8,
        writePolicy: { allow: ["src/**", "index.html"] },
        qa: createQaAgent({ systemPrompt: "test-qa" }),
        qaModel: "test-qa-model",
        runTypecheck: async () => ({ ok: true, log: "" }),
      },
    );
    expect(handoff.ok).toBe(true);
    if (!handoff.ok) return;
    await handoff.run();

    const joined = (capturedMessages ?? [])
      .map((m) => (typeof m.content === "string" ? m.content : ""))
      .join("\n");
    expect(joined).toContain("【记忆】");
    expect(joined).toContain(summary.trim());
    expect(joined).not.toContain("【已确认需求】");
  });

  it("send + confirm_requirement with teamEnabled reports nextTurn team", async () => {
    const { project, messages: seeded } = createProject(
      {
        ownerUserId: "demo",
        requirement: "做一个待办应用",
        mode: "engineer",
      },
      workspace,
    );
    enablePlan(workspace, project.id, { teamEnabled: true });
    const seedAssistant = seeded.find((m) => m.role === "assistant");
    expect(seedAssistant).toBeTruthy();
    workspace.updateMessage(seedAssistant!.id, { content: "先聊聊需求" });

    const summary = "  待办应用：增删改查 + 本地存储  ";
    const begun = beginPlanTurn(
      {
        ownerUserId: "demo",
        projectId: project.id,
        action: "send",
        content: "就按这个做吧",
      },
      {
        workspace,
        preferences: fakePreferences,
        llm: llmFromScript([
          [
            {
              type: "tool_calls",
              toolCalls: [
                {
                  id: "c1",
                  type: "function",
                  function: {
                    name: "confirm_requirement",
                    arguments: JSON.stringify({ summary }),
                  },
                },
              ],
            },
            { type: "finished", finishReason: "tool_calls" },
          ],
          [
            { type: "content_delta", text: "已确认需求，接下来交给团队。" },
            { type: "finished", finishReason: "stop" },
          ],
        ]),
        agent: createRequirementAgent({ systemPrompt: "test" }),
        model: "test-model",
        maxToolRounds: 8,
      },
    );

    expect(begun.ok).toBe(true);
    if (!begun.ok) return;

    const events = await runAndCollect(project.id, begun.run);

    const again = workspace.getProject(project.id)!;
    expect(again.planEnabled).toBe(false);
    expect(again.planConfirmed).toBe(true);
    expect(again.confirmedRequirement).toBe(summary.trim());
    expect(again.teamEnabled).toBe(true);
    expect(workspace.readFile(project.id, PRODUCT_SPEC_PATH)).toContain(
      summary.trim(),
    );

    const last = workspace.listMessages(project.id).at(-1);
    expect(last?.content).toBe("已确认需求，接下来交给团队。");
    expect(last?.agentName).toBe("Pat");

    expect(
      events.some(
        (e) =>
          e.type === "done" &&
          e.filesChanged === false &&
          e.previewEnqueued === false &&
          e.planConfirmed === true &&
          e.nextTurn === "team" &&
          e.messageId === last?.id,
      ),
    ).toBe(true);
  });

  it("confirm_requirement write failure leaves meta unconfirmed", async () => {
    const { project, messages: seeded } = createProject(
      {
        ownerUserId: "demo",
        requirement: "做一个待办应用",
        mode: "engineer",
      },
      workspace,
    );
    enablePlan(workspace, project.id, { teamEnabled: false });
    workspace.updateMessage(seeded.find((m) => m.role === "assistant")!.id, {
      content: "先聊聊需求",
    });

    const origWrite = workspace.writeFile.bind(workspace);
    vi.spyOn(workspace, "writeFile").mockImplementation(
      (projectId, relativePath, content) => {
        if (relativePath === PRODUCT_SPEC_PATH) {
          throw new Error("disk full");
        }
        return origWrite(projectId, relativePath, content);
      },
    );

    const begun = beginPlanTurn(
      {
        ownerUserId: "demo",
        projectId: project.id,
        action: "send",
        content: "就按这个做吧",
      },
      {
        workspace,
        preferences: fakePreferences,
        llm: llmFromScript([
          [
            {
              type: "tool_calls",
              toolCalls: [
                {
                  id: "c1",
                  type: "function",
                  function: {
                    name: "confirm_requirement",
                    arguments: JSON.stringify({
                      summary: "待办应用：增删改查",
                    }),
                  },
                },
              ],
            },
            { type: "finished", finishReason: "tool_calls" },
          ],
          [
            { type: "content_delta", text: "写入失败，请重试。" },
            { type: "finished", finishReason: "stop" },
          ],
        ]),
        agent: createRequirementAgent({ systemPrompt: "test" }),
        model: "test-model",
        maxToolRounds: 8,
      },
    );

    expect(begun.ok).toBe(true);
    if (!begun.ok) return;

    const events = await runAndCollect(project.id, begun.run);
    const again = workspace.getProject(project.id)!;
    expect(again.planConfirmed).toBe(false);
    expect(again.planEnabled).toBe(true);
    expect(again.confirmedRequirement).toBeFalsy();
    expect(
      events.some(
        (e) => e.type === "done" && e.planConfirmed === true,
      ),
    ).toBe(false);
  });

  it("unconfirmed turn keeps filesChanged and previewEnqueued false", async () => {
    const { project, messages: seeded } = createProject(
      {
        ownerUserId: "demo",
        requirement: "做一个待办应用",
        mode: "engineer",
      },
      workspace,
    );
    enablePlan(workspace, project.id);
    workspace.updateMessage(seeded.find((m) => m.role === "assistant")!.id, {
      content: "先前澄清",
    });

    const begun = beginPlanTurn(
      {
        ownerUserId: "demo",
        projectId: project.id,
        action: "send",
        content: "用户是小团队",
      },
      {
        workspace,
        preferences: fakePreferences,
        llm: llmFromScript([
          [
            { type: "content_delta", text: "明白，还有其他约束吗？" },
            { type: "finished", finishReason: "stop" },
          ],
        ]),
        agent: createRequirementAgent({ systemPrompt: "test" }),
        model: "test-model",
        maxToolRounds: 8,
      },
    );

    expect(begun.ok).toBe(true);
    if (!begun.ok) return;

    const events = await runAndCollect(project.id, begun.run);
    const proj = workspace.getProject(project.id)!;
    expect(proj.planEnabled).toBe(true);
    expect(proj.planConfirmed).toBe(false);

    expect(
      events.some(
        (e) =>
          e.type === "done" &&
          e.filesChanged === false &&
          e.previewEnqueued === false,
      ),
    ).toBe(true);
  });
});
