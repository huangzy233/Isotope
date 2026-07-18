import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRequirementAgent } from "@isotope/agents";
import type { LlmClient, LlmStreamEvent } from "@isotope/llm";
import { createFsSqliteWorkspace } from "@isotope/workspace";
import { createProject } from "./create-project.js";
import { ASSISTANT_PLACEHOLDER } from "./placeholder.js";
import {
  beginPlanTurn,
  type PlanTurnEvent,
} from "./stream-plan-turn.js";
import { subscribeTurn } from "./turn-hub.js";

const templatePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../templates/vite-react",
);

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
        llm: llmFromScript([
          [
            { type: "content_delta", text: "先确认一下目标用户？" },
            { type: "finished", finishReason: "stop" },
          ],
        ]),
        agent: createRequirementAgent({ systemPrompt: "test" }),
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
        llm: llmFromScript([
          [
            { type: "content_delta", text: "明白，还有其他约束吗？" },
            { type: "finished", finishReason: "stop" },
          ],
        ]),
        agent: createRequirementAgent({ systemPrompt: "test" }),
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
