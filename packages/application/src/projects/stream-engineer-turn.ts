import { runTurn } from "@isotope/agent-runtime";
import type { CoderAgent, QaAgent } from "@isotope/agents";
import type { LlmClient } from "@isotope/llm";
import { isPreferenceKey, type PreferenceStore } from "@isotope/memory";
import type { PreviewService } from "@isotope/preview";
import type { MessageProcess, WorkspaceStore } from "@isotope/workspace";
import { appendDecision } from "./append-decision.js";
import { buildTurnContext } from "./build-turn-context.js";
import { checkpointProcess } from "./checkpoint-process.js";
import { enqueuePreviewBuild } from "./enqueue-preview-build.js";
import { getProject } from "./get-project.js";
import {
  createPlanGatedWritePort,
  isPlanClarifyGateOpen,
} from "./plan-gate.js";
import { ASSISTANT_PLACEHOLDER } from "./placeholder.js";
import { runQualityLoop } from "./run-quality-loop.js";
import { isTransportDisconnectError } from "./transport-error.js";
import {
  destroyTurnHub,
  ensureTurnHub,
  publishTurnEvent,
} from "./turn-hub.js";
import { releaseTurnLock, tryAcquireTurnLock } from "./turn-lock.js";
import {
  createWritePolicyPort,
  type WritePolicy,
} from "./write-policy.js";

export type EngineerTurnEvent =
  | { type: "speaker"; agentName: "Alex" | "QA"; messageId: string }
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
  preferences: PreferenceStore;
  preview: PreviewService;
  llm: LlmClient;
  agent: CoderAgent;
  model: string;
  maxToolRounds: number;
  writePolicy: WritePolicy;
  qa: QaAgent;
  qaModel: string;
  runTypecheck: (projectId: string) => Promise<{ ok: boolean; log: string }>;
};

export type BeginEngineerTurnResult =
  | { ok: false; status: "not_found" | "bad_request" | "conflict" }
  | {
      ok: true;
      run: () => Promise<void>;
    };

function changedPathsBlock(paths: string[]): string {
  return `【本轮变更】\n${paths.map((p) => `- ${p}`).join("\n")}`;
}

function trackProcess(
  process: MessageProcess,
  publish: (event: EngineerTurnEvent) => void,
  checkpoint: () => void,
) {
  return {
    onToken: (text: string) => publish({ type: "token", text }),
    onThinking: (text: string) => {
      const last = process.steps.at(-1);
      if (last?.type === "thinking") {
        last.text += text;
      } else {
        process.steps.push({ type: "thinking", text });
        checkpoint();
      }
      publish({ type: "thinking", text });
    },
    onTool: (ev: {
      id: string;
      name: string;
      state: "start" | "end";
      summary?: string;
      ok?: boolean;
    }) => {
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
    onStatus: (phase: "thinking" | "running" | "streaming") =>
      publish({ type: "status", phase }),
  };
}

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

        const buildHistory = (extraUserContent?: string) => {
          const { history } = buildTurnContext({
            messages: deps.workspace.listMessages(input.projectId),
            project:
              deps.workspace.getProject(input.projectId) ?? project,
            preferences: deps.preferences.getPreferences(input.ownerUserId),
            readProjectFile: (p) => {
              try {
                return deps.workspace.readFile(input.projectId, p);
              } catch {
                return null;
              }
            },
          });
          if (extraUserContent) {
            history.push({ role: "user", content: extraUserContent });
          }
          return history;
        };

        const basePort = {
          listFiles: (dir?: string) =>
            deps.workspace.listFiles(input.projectId, dir),
          readFile: (p: string) =>
            deps.workspace.readFile(input.projectId, p),
          writeFile: (p: string, c: string) =>
            deps.workspace.writeFile(input.projectId, p, c),
          setPreference(key: string, value: string) {
            if (!isPreferenceKey(key)) {
              return { ok: false as const, error: "unknown key" };
            }
            try {
              deps.preferences.upsertPreference(
                input.ownerUserId,
                key,
                value,
              );
              return { ok: true as const };
            } catch (e) {
              return {
                ok: false as const,
                error: e instanceof Error ? e.message : String(e),
              };
            }
          },
          rememberDecision(text: string) {
            try {
              appendDecision(deps.workspace, input.projectId, text);
              return { ok: true as const };
            } catch (e) {
              return {
                ok: false as const,
                error: e instanceof Error ? e.message : String(e),
              };
            }
          },
        };

        const alexPort = () => {
          const latest =
            deps.workspace.getProject(input.projectId) ?? project;
          return createPlanGatedWritePort(
            latest,
            createWritePolicyPort(deps.writePolicy, basePort),
          );
        };

        const process: MessageProcess = { steps: [] };
        const checkpoint = () => {
          if (replaceId) {
            checkpointProcess(deps.workspace, replaceId, process);
          }
        };
        const callbacks = trackProcess(process, publish, checkpoint);

        try {
          if (replaceId) {
            publish({
              type: "speaker",
              agentName: "Alex",
              messageId: replaceId,
            });
          }

          const result = await runTurn({
            llm: deps.llm,
            model: deps.model,
            agent: deps.agent,
            port: alexPort(),
            history: buildHistory(),
            maxToolRounds: deps.maxToolRounds,
            ...callbacks,
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

          const quality = await runQualityLoop({
            projectId: input.projectId,
            ownerUserId: input.ownerUserId,
            initial: {
              writtenPaths: result.writtenPaths,
              assistantText: text,
            },
            runQa: async (changedPaths) => {
              const qaMsg = deps.workspace.appendMessage({
                projectId: input.projectId,
                role: "assistant",
                content: ASSISTANT_PLACEHOLDER,
                agentName: "QA",
              });
              publish({
                type: "speaker",
                agentName: "QA",
                messageId: qaMsg.id,
              });

              const qaProcess: MessageProcess = { steps: [] };
              const qaCheckpoint = () =>
                checkpointProcess(deps.workspace, qaMsg.id, qaProcess);
              const qaCallbacks = trackProcess(
                qaProcess,
                publish,
                qaCheckpoint,
              );

              let checkRan = false;
              let checkOk = false;
              const qaPort = {
                listFiles: (dir?: string) =>
                  deps.workspace.listFiles(input.projectId, dir),
                readFile: (p: string) =>
                  deps.workspace.readFile(input.projectId, p),
                runCheck: async () => {
                  checkRan = true;
                  const r = await deps.runTypecheck(input.projectId);
                  checkOk = r.ok;
                  return r;
                },
              };

              const qaResult = await runTurn({
                llm: deps.llm,
                model: deps.qaModel,
                agent: deps.qa,
                port: qaPort,
                history: buildHistory(changedPathsBlock(changedPaths)),
                maxToolRounds: deps.maxToolRounds,
                ...qaCallbacks,
              });

              const qaText = !checkRan
                ? "【质检结果】FAIL\n质检未执行 run_check"
                : qaResult.assistantText || "（无质检报告）";
              deps.workspace.updateMessage(qaMsg.id, {
                content: qaText,
                process: qaResult.process,
              });

              return {
                assistantText: qaText,
                checkRan,
                checkOk,
              };
            },
            runAlexRepair: async (extraUserContent) => {
              const repairMsg = deps.workspace.appendMessage({
                projectId: input.projectId,
                role: "assistant",
                content: ASSISTANT_PLACEHOLDER,
                agentName: "Alex",
              });
              publish({
                type: "speaker",
                agentName: "Alex",
                messageId: repairMsg.id,
              });

              const repairProcess: MessageProcess = { steps: [] };
              const repairCheckpoint = () =>
                checkpointProcess(
                  deps.workspace,
                  repairMsg.id,
                  repairProcess,
                );
              const repairCallbacks = trackProcess(
                repairProcess,
                publish,
                repairCheckpoint,
              );

              const repairResult = await runTurn({
                llm: deps.llm,
                model: deps.model,
                agent: deps.agent,
                port: alexPort(),
                history: buildHistory(extraUserContent),
                maxToolRounds: deps.maxToolRounds,
                ...repairCallbacks,
              });

              const repairText =
                repairResult.assistantText || "（无回复内容）";
              deps.workspace.updateMessage(repairMsg.id, {
                content: repairText,
                process: repairResult.process,
              });

              return {
                writtenPaths: repairResult.writtenPaths,
                assistantText: repairText,
              };
            },
          });

          let previewEnqueued = false;
          if (quality.shouldEnqueuePreview) {
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
