import { runTurn } from "@isotope/agent-runtime";
import type { ConfirmRequirementPort, RequirementAgent } from "@isotope/agents";
import type { LlmClient } from "@isotope/llm";
import type { MessageProcess, WorkspaceStore } from "@isotope/workspace";
import { checkpointProcess } from "./checkpoint-process.js";
import { getProject } from "./get-project.js";
import { ASSISTANT_PLACEHOLDER } from "./placeholder.js";
import { isTransportDisconnectError } from "./transport-error.js";
import {
  destroyTurnHub,
  ensureTurnHub,
  publishTurnEvent,
} from "./turn-hub.js";
import { releaseTurnLock, tryAcquireTurnLock } from "./turn-lock.js";

export type PlanTurnEvent =
  | { type: "status"; phase: "thinking" | "running" | "streaming" }
  | { type: "thinking"; text: string }
  | {
      type: "tool";
      id: string;
      name: string;
      state: "start" | "end";
      summary?: string;
      ok?: boolean;
    }
  | { type: "token"; text: string }
  | {
      type: "done";
      messageId: string;
      filesChanged: false;
      previewEnqueued: false;
      planConfirmed?: boolean;
      nextTurn?: "engineer" | "team";
    }
  | { type: "error"; message: string };

export type PlanTurnInput =
  | {
      ownerUserId: string;
      projectId: string;
      action: "continue";
    }
  | {
      ownerUserId: string;
      projectId: string;
      action: "send";
      content: string;
    };

export type PlanTurnDeps = {
  workspace: WorkspaceStore;
  llm: LlmClient;
  agent: RequirementAgent;
  maxToolRounds: number;
};

export type BeginPlanTurnResult =
  | { ok: false; status: "not_found" | "bad_request" | "conflict" }
  | {
      ok: true;
      run: () => Promise<void>;
    };

/** 同步：归属 / 占位或 content 校验 / 加锁。失败不持锁。成功后必须调用 run（run 的 finally 释放锁）。 */
export function beginPlanTurn(
  input: PlanTurnInput,
  deps: PlanTurnDeps,
): BeginPlanTurnResult {
  if (
    !getProject(
      { ownerUserId: input.ownerUserId, projectId: input.projectId },
      deps.workspace,
    )
  ) {
    return { ok: false, status: "not_found" };
  }

  const messages = deps.workspace.listMessages(input.projectId);
  let replaceId: string | null = null;

  if (input.action === "continue") {
    const last = messages.at(-1);
    if (
      !last ||
      last.role !== "assistant" ||
      last.content !== ASSISTANT_PLACEHOLDER
    ) {
      return { ok: false, status: "bad_request" };
    }
    replaceId = last.id;
  } else {
    if (!input.content.trim()) {
      return { ok: false, status: "bad_request" };
    }
  }

  if (!tryAcquireTurnLock(input.projectId)) {
    return { ok: false, status: "conflict" };
  }

  ensureTurnHub(input.projectId);

  // send：加锁成功后再清理遗留占位并 append user，避免 conflict 时脏写
  if (input.action === "send") {
    for (const m of deps.workspace.listMessages(input.projectId)) {
      if (m.role === "assistant" && m.content === ASSISTANT_PLACEHOLDER) {
        deps.workspace.updateMessage(m.id, {
          content: "（上一轮待生成已取消）",
        });
      }
    }
    deps.workspace.appendMessage({
      projectId: input.projectId,
      role: "user",
      content: input.content.trim(),
    });
    replaceId = deps.workspace.appendMessage({
      projectId: input.projectId,
      role: "assistant",
      content: ASSISTANT_PLACEHOLDER,
      agentName: deps.agent.displayName,
    }).id;
  }

  return {
    ok: true,
    run: async () => {
      const publish = (event: PlanTurnEvent) =>
        publishTurnEvent(input.projectId, event);

      let confirmedThisTurn = false;
      let nextTurnForDone: "engineer" | "team" | undefined;

      try {
        const history = deps.workspace
          .listMessages(input.projectId)
          .filter((m) => m.role === "user" || m.role === "assistant")
          .filter((m) => m.content !== ASSISTANT_PLACEHOLDER)
          .map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          }));

        const confirmPort: ConfirmRequirementPort = {
          confirmRequirement(summary: string) {
            const s = summary.trim();
            if (!s) return { ok: false, error: "摘要不能为空" };
            const proj = deps.workspace.getProject(input.projectId);
            if (!proj) return { ok: false, error: "项目不存在" };
            const nextTurn = proj.teamEnabled ? "team" : "engineer";
            deps.workspace.updateProjectMeta(input.projectId, {
              planConfirmed: true,
              confirmedRequirement: s,
              planEnabled: false,
            });
            confirmedThisTurn = true;
            nextTurnForDone = nextTurn;
            return { ok: true };
          },
        };

        const process: MessageProcess = { steps: [] };
        const checkpoint = () => {
          if (replaceId) {
            checkpointProcess(deps.workspace, replaceId, process);
          }
        };

        try {
          const result = await runTurn({
            llm: deps.llm,
            agent: deps.agent,
            port: confirmPort,
            history,
            maxToolRounds: deps.maxToolRounds,
            onToken: (text) => publish({ type: "token", text }),
            onThinking: (text) => {
              const last = process.steps.at(-1);
              if (last?.type === "thinking") {
                last.text += text;
              } else {
                process.steps.push({ type: "thinking", text });
                checkpoint();
              }
              publish({ type: "thinking", text });
            },
            onTool: (ev) => {
              if (ev.state === "start") {
                process.steps.push({
                  type: "tool",
                  id: ev.id,
                  name: ev.name,
                  status: "running",
                  summary: ev.summary,
                });
              } else {
                const idx = process.steps.findIndex(
                  (s) => s.type === "tool" && s.id === ev.id,
                );
                const status = ev.ok === false ? "error" : "done";
                if (idx >= 0 && process.steps[idx]?.type === "tool") {
                  const prev = process.steps[idx];
                  process.steps[idx] = {
                    type: "tool",
                    id: prev.id,
                    name: prev.name,
                    status,
                    summary: ev.summary ?? prev.summary,
                  };
                } else {
                  process.steps.push({
                    type: "tool",
                    id: ev.id,
                    name: ev.name,
                    status,
                    summary: ev.summary,
                  });
                }
              }
              checkpoint();
              publish({
                type: "tool",
                id: ev.id,
                name: ev.name,
                state: ev.state,
                summary: ev.summary,
                ok: ev.ok,
              });
            },
            onStatus: (phase) => publish({ type: "status", phase }),
          });

          const text = result.assistantText || "（无回复内容）";
          let messageId: string;
          if (replaceId) {
            messageId = deps.workspace.updateMessage(replaceId, {
              content: text,
              process: result.process,
            })!.id;
          } else {
            messageId = deps.workspace.appendMessage({
              projectId: input.projectId,
              role: "assistant",
              content: text,
              agentName: deps.agent.displayName,
              process: result.process,
            }).id;
          }

          const done: PlanTurnEvent = {
            type: "done",
            messageId,
            filesChanged: false,
            previewEnqueued: false,
          };
          if (confirmedThisTurn) {
            done.planConfirmed = true;
            done.nextTurn = nextTurnForDone;
          }
          publish(done);
        } catch (err) {
          // SSE / stream controller 关闭属于传输层，不得写成业务「生成失败」
          if (isTransportDisconnectError(err)) {
            return;
          }
          const msg =
            "生成失败：" +
            (err instanceof Error ? err.message : "未知错误").slice(0, 300);
          const failurePatch =
            process.steps.length > 0
              ? { content: msg, process }
              : { content: msg };
          if (replaceId) {
            deps.workspace.updateMessage(replaceId, failurePatch);
          } else {
            deps.workspace.appendMessage({
              projectId: input.projectId,
              role: "assistant",
              agentName: deps.agent.displayName,
              ...failurePatch,
            });
          }
          publish({ type: "error", message: msg });
        }
      } finally {
        destroyTurnHub(input.projectId);
        releaseTurnLock(input.projectId);
      }
    },
  };
}
