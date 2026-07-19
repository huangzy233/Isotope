import { runTurn } from "@isotope/agent-runtime";
import type { CoderAgent } from "@isotope/agents";
import type { LlmClient } from "@isotope/llm";
import type { PreviewService } from "@isotope/preview";
import type { MessageProcess, WorkspaceStore } from "@isotope/workspace";
import { checkpointProcess } from "./checkpoint-process.js";
import { enqueuePreviewBuild } from "./enqueue-preview-build.js";
import { getProject } from "./get-project.js";
import {
  createPlanGatedWritePort,
  isPlanClarifyGateOpen,
} from "./plan-gate.js";
import { ASSISTANT_PLACEHOLDER } from "./placeholder.js";
import { isTransportDisconnectError } from "./transport-error.js";
import {
  destroyTurnHub,
  ensureTurnHub,
  publishTurnEvent,
} from "./turn-hub.js";
import { releaseTurnLock, tryAcquireTurnLock } from "./turn-lock.js";

export type EngineerTurnEvent =
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
      filesChanged: boolean;
      previewEnqueued: boolean;
    }
  | { type: "error"; message: string };

export type EngineerTurnInput =
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
      silentHandoff?: false;
    }
  | {
      ownerUserId: string;
      projectId: string;
      action: "send";
      content?: string;
      silentHandoff: true;
    };

export type EngineerTurnDeps = {
  workspace: WorkspaceStore;
  preview: PreviewService;
  llm: LlmClient;
  agent: CoderAgent;
  model: string;
  maxToolRounds: number;
};

export type BeginEngineerTurnResult =
  | { ok: false; status: "not_found" | "bad_request" | "conflict" }
  | {
      ok: true;
      run: () => Promise<void>;
    };

/** 同步：归属 / 占位或 content 校验 / 加锁。失败不持锁。成功后必须调用 run（run 的 finally 释放锁）。 */
export function beginEngineerTurn(
  input: EngineerTurnInput,
  deps: EngineerTurnDeps,
): BeginEngineerTurnResult {
  const owned = getProject(
    { ownerUserId: input.ownerUserId, projectId: input.projectId },
    deps.workspace,
  );
  if (!owned) {
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
  } else if (input.silentHandoff) {
    if (!owned.planConfirmed || !owned.confirmedRequirement) {
      return { ok: false, status: "bad_request" };
    }
  } else if (!input.content.trim()) {
    return { ok: false, status: "bad_request" };
  }

  if (!tryAcquireTurnLock(input.projectId)) {
    return { ok: false, status: "conflict" };
  }

  ensureTurnHub(input.projectId);

  // send：加锁成功后再清理遗留占位；silentHandoff 不 append user
  if (input.action === "send") {
    for (const m of deps.workspace.listMessages(input.projectId)) {
      if (m.role === "assistant" && m.content === ASSISTANT_PLACEHOLDER) {
        deps.workspace.updateMessage(m.id, {
          content: "（上一轮待生成已取消）",
        });
      }
    }
    if (!input.silentHandoff) {
      deps.workspace.appendMessage({
        projectId: input.projectId,
        role: "user",
        content: input.content.trim(),
      });
    }
    replaceId = deps.workspace.appendMessage({
      projectId: input.projectId,
      role: "assistant",
      content: ASSISTANT_PLACEHOLDER,
      agentName: "Alex",
    }).id;
  }

  return {
    ok: true,
    run: async () => {
      const publish = (event: EngineerTurnEvent) =>
        publishTurnEvent(input.projectId, event);

      try {
        const project =
          deps.workspace.getProject(input.projectId) ?? owned;

        const history = deps.workspace
          .listMessages(input.projectId)
          .filter((m) => m.role === "user" || m.role === "assistant")
          .filter((m) => m.content !== ASSISTANT_PLACEHOLDER)
          .map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          }));
        if (project.confirmedRequirement) {
          history.unshift({
            role: "user",
            content: `【已确认需求】\n${project.confirmedRequirement}`,
          });
        }

        const basePort = {
          listFiles: (dir?: string) =>
            deps.workspace.listFiles(input.projectId, dir),
          readFile: (p: string) =>
            deps.workspace.readFile(input.projectId, p),
          writeFile: (p: string, c: string) =>
            deps.workspace.writeFile(input.projectId, p, c),
        };
        const port = createPlanGatedWritePort(project, basePort);

        const process: MessageProcess = { steps: [] };
        const checkpoint = () => {
          if (replaceId) {
            checkpointProcess(deps.workspace, replaceId, process);
          }
        };

        try {
          const result = await runTurn({
            llm: deps.llm,
            model: deps.model,
            agent: deps.agent,
            port,
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
              agentName: "Alex",
              process: result.process,
            }).id;
          }

          let previewEnqueued = false;
          if (result.filesChanged) {
            const latest =
              deps.workspace.getProject(input.projectId) ?? project;
            if (!isPlanClarifyGateOpen(latest)) {
              enqueuePreviewBuild(
                {
                  ownerUserId: input.ownerUserId,
                  projectId: input.projectId,
                },
                deps.workspace,
                deps.preview,
                { recordVersionIntent: true },
              );
              previewEnqueued = true;
            }
          }
          publish({
            type: "done",
            messageId,
            filesChanged: result.filesChanged,
            previewEnqueued,
          });
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
              agentName: "Alex",
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
