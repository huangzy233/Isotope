import { runTurn } from "@isotope/agent-runtime";
import type { CoderAgent } from "@isotope/agents";
import type { LlmClient } from "@isotope/llm";
import type { PreviewService } from "@isotope/preview";
import type { WorkspaceStore } from "@isotope/workspace";
import { enqueuePreviewBuild } from "./enqueue-preview-build.js";
import { getProject } from "./get-project.js";
import { ASSISTANT_PLACEHOLDER } from "./placeholder.js";
import { releaseTurnLock, tryAcquireTurnLock } from "./turn-lock.js";

export type EngineerTurnEvent =
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
    };

export type EngineerTurnDeps = {
  workspace: WorkspaceStore;
  preview: PreviewService;
  llm: LlmClient;
  agent: CoderAgent;
  maxToolRounds: number;
};

export type BeginEngineerTurnResult =
  | { ok: false; status: "not_found" | "bad_request" | "conflict" }
  | {
      ok: true;
      run: (emit: (event: EngineerTurnEvent) => void) => Promise<void>;
    };

/** 同步：归属 / 占位或 content 校验 / 加锁。失败不持锁。成功后必须调用 run（run 的 finally 释放锁）。 */
export function beginEngineerTurn(
  input: EngineerTurnInput,
  deps: EngineerTurnDeps,
): BeginEngineerTurnResult {
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
  }

  return {
    ok: true,
    run: async (emit) => {
      try {
        const history = deps.workspace
          .listMessages(input.projectId)
          .filter((m) => m.role === "user" || m.role === "assistant")
          .filter((m) => m.content !== ASSISTANT_PLACEHOLDER)
          .map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          }));

        const port = {
          listFiles: (dir?: string) =>
            deps.workspace.listFiles(input.projectId, dir),
          readFile: (p: string) =>
            deps.workspace.readFile(input.projectId, p),
          writeFile: (p: string, c: string) =>
            deps.workspace.writeFile(input.projectId, p, c),
        };

        try {
          const result = await runTurn({
            llm: deps.llm,
            agent: deps.agent,
            port,
            history,
            maxToolRounds: deps.maxToolRounds,
            onToken: (text) => emit({ type: "token", text }),
          });

          const text = result.assistantText || "（无回复内容）";
          let messageId: string;
          if (replaceId) {
            messageId = deps.workspace.updateMessage(replaceId, {
              content: text,
            })!.id;
          } else {
            messageId = deps.workspace.appendMessage({
              projectId: input.projectId,
              role: "assistant",
              content: text,
              agentName: "Alex",
            }).id;
          }

          let previewEnqueued = false;
          if (result.filesChanged) {
            enqueuePreviewBuild(
              {
                ownerUserId: input.ownerUserId,
                projectId: input.projectId,
              },
              deps.workspace,
              deps.preview,
            );
            previewEnqueued = true;
          }
          emit({
            type: "done",
            messageId,
            filesChanged: result.filesChanged,
            previewEnqueued,
          });
        } catch (err) {
          const msg =
            "生成失败：" +
            (err instanceof Error ? err.message : "未知错误").slice(0, 300);
          if (replaceId) {
            deps.workspace.updateMessage(replaceId, { content: msg });
          } else {
            deps.workspace.appendMessage({
              projectId: input.projectId,
              role: "assistant",
              content: msg,
              agentName: "Alex",
            });
          }
          emit({ type: "error", message: msg });
        }
      } finally {
        releaseTurnLock(input.projectId);
      }
    },
  };
}
