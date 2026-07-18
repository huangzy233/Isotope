import { runTurn } from "@isotope/agent-runtime";
import type { CoderAgent, LeaderAgent, TaskToolPort } from "@isotope/agents";
import type { LlmClient } from "@isotope/llm";
import type { PreviewService } from "@isotope/preview";
import type {
  MessageProcess,
  Task,
  TaskStatus,
  WorkspaceStore,
} from "@isotope/workspace";
import { enqueuePreviewBuild } from "./enqueue-preview-build.js";
import { getProject } from "./get-project.js";
import { ASSISTANT_PLACEHOLDER } from "./placeholder.js";
import type { TaskEventBus } from "./task-event-bus.js";
import type { EngineerTurnInput } from "./stream-engineer-turn.js";
import { releaseTurnLock, tryAcquireTurnLock } from "./turn-lock.js";

export type TeamTurnEvent =
  | { type: "speaker"; agentName: "Mike" | "Alex"; messageId: string }
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
      type: "task";
      taskId: string;
      status: TaskStatus;
      title: string;
      assignee: "Alex";
    }
  | {
      type: "done";
      messageId: string;
      filesChanged: boolean;
      previewEnqueued: boolean;
      taskId?: string;
    }
  | { type: "error"; message: string };

export type TeamTurnDeps = {
  workspace: WorkspaceStore;
  preview: PreviewService;
  llm: LlmClient;
  leader: LeaderAgent;
  coder: CoderAgent;
  bus: TaskEventBus;
  maxToolRounds: number;
};

export type BeginTeamTurnResult =
  | { ok: false; status: "not_found" | "bad_request" | "conflict" }
  | {
      ok: true;
      run: (emit: (event: TeamTurnEvent) => void) => Promise<void>;
    };

function historyForProject(
  workspace: WorkspaceStore,
  projectId: string,
): Array<{ role: "user" | "assistant"; content: string }> {
  return workspace
    .listMessages(projectId)
    .filter((m) => m.role === "user" || m.role === "assistant")
    .filter((m) => m.content !== ASSISTANT_PLACEHOLDER)
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));
}

function trackProcess(
  process: MessageProcess,
  emit: (event: TeamTurnEvent) => void,
) {
  return {
    onToken: (text: string) => emit({ type: "token", text }),
    onThinking: (text: string) => {
      const last = process.steps.at(-1);
      if (last?.type === "thinking") {
        last.text += text;
      } else {
        process.steps.push({ type: "thinking", text });
      }
      emit({ type: "thinking", text });
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
      emit({
        type: "tool",
        id: ev.id,
        name: ev.name,
        state: ev.state,
        summary: ev.summary,
        ok: ev.ok,
      });
    },
    onStatus: (phase: "thinking" | "running" | "streaming") =>
      emit({ type: "status", phase }),
  };
}

function emitTask(
  emit: (event: TeamTurnEvent) => void,
  task: Task,
): void {
  emit({
    type: "task",
    taskId: task.id,
    status: task.status,
    title: task.title,
    assignee: task.assignee,
  });
}

function failTask(
  deps: TeamTurnDeps,
  taskId: string | undefined,
  error?: string,
  emit?: (event: TeamTurnEvent) => void,
): void {
  if (!taskId) return;
  const existing = deps.workspace.getTask(taskId);
  if (!existing || existing.status === "completed" || existing.status === "failed") {
    return;
  }
  const prevStatus = existing.status;
  const failed = deps.workspace.updateTask(taskId, { status: "failed" });
  if (failed) {
    deps.bus.publish({ type: "task.failed", task: failed, error });
    deps.bus.publish({ type: "task.updated", task: failed, prevStatus });
    if (emit) emitTask(emit, failed);
  }
}

async function runAlexForTask(input: {
  projectId: string;
  ownerUserId: string;
  task: Task;
  deps: TeamTurnDeps;
  emit?: (event: TeamTurnEvent) => void;
  extraUserContent?: string;
}): Promise<{ messageId: string; filesChanged: boolean; previewEnqueued: boolean }> {
  const { projectId, ownerUserId, task, deps, emit, extraUserContent } = input;
  const prevStatus = task.status;
  const running = deps.workspace.updateTask(task.id, { status: "running" });
  if (!running) {
    throw new Error("任务不存在");
  }
  deps.bus.publish({ type: "task.updated", task: running, prevStatus });
  emit?.(
    {
      type: "task",
      taskId: running.id,
      status: running.status,
      title: running.title,
      assignee: running.assignee,
    },
  );

  const alexMsg = deps.workspace.appendMessage({
    projectId,
    role: "assistant",
    content: ASSISTANT_PLACEHOLDER,
    agentName: "Alex",
    taskId: task.id,
  });
  deps.workspace.updateTask(task.id, { assigneeMessageId: alexMsg.id });
  emit?.({ type: "speaker", agentName: "Alex", messageId: alexMsg.id });

  const process: MessageProcess = { steps: [] };
  const callbacks = emit
    ? trackProcess(process, emit)
    : {
        onToken: () => {},
        onThinking: undefined,
        onTool: undefined,
        onStatus: undefined,
      };

  const history = historyForProject(deps.workspace, projectId);
  if (extraUserContent) {
    history.push({ role: "user", content: extraUserContent });
  }

  const filePort = {
    listFiles: (dir?: string) => deps.workspace.listFiles(projectId, dir),
    readFile: (p: string) => deps.workspace.readFile(projectId, p),
    writeFile: (p: string, c: string) =>
      deps.workspace.writeFile(projectId, p, c),
  };

  try {
    const result = await runTurn({
      llm: deps.llm,
      agent: deps.coder,
      port: filePort,
      history,
      maxToolRounds: deps.maxToolRounds,
      ...callbacks,
    });

    const text = result.assistantText || "（无回复内容）";
    deps.workspace.updateMessage(alexMsg.id, {
      content: text,
      process: result.process,
    });

    const completed = deps.workspace.updateTask(task.id, { status: "completed" });
    if (completed) {
      deps.bus.publish({ type: "task.completed", task: completed });
      deps.bus.publish({
        type: "task.updated",
        task: completed,
        prevStatus: "running",
      });
      emit?.(
        {
          type: "task",
          taskId: completed.id,
          status: completed.status,
          title: completed.title,
          assignee: completed.assignee,
        },
      );
    }

    let previewEnqueued = false;
    if (result.filesChanged) {
      enqueuePreviewBuild(
        { ownerUserId, projectId },
        deps.workspace,
        deps.preview,
      );
      previewEnqueued = true;
    }

    return {
      messageId: alexMsg.id,
      filesChanged: result.filesChanged,
      previewEnqueued,
    };
  } catch (err) {
    const msg =
      "生成失败：" +
      (err instanceof Error ? err.message : "未知错误").slice(0, 300);
    const failurePatch =
      process.steps.length > 0
        ? { content: msg, process }
        : { content: msg };
    deps.workspace.updateMessage(alexMsg.id, failurePatch);
    failTask(deps, task.id, msg, emit);
    throw err;
  }
}

/** 同步：归属 / 占位或 content 校验 / 加锁。失败不持锁。成功后必须调用 run（run 的 finally 释放锁）。 */
export function beginTeamTurn(
  input: EngineerTurnInput,
  deps: TeamTurnDeps,
): BeginTeamTurnResult {
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
      let createdTaskId: string | undefined;
      let mikeMessageId = "";
      const mikeProcess: MessageProcess = { steps: [] };
      try {
        mikeMessageId = replaceId
          ? replaceId
          : deps.workspace.appendMessage({
              projectId: input.projectId,
              role: "assistant",
              content: ASSISTANT_PLACEHOLDER,
              agentName: "Mike",
            }).id;

        emit({ type: "speaker", agentName: "Mike", messageId: mikeMessageId });

        const mikeCallbacks = trackProcess(mikeProcess, emit);

        const taskPort: TaskToolPort = {
          createTask: (args: { title: string; assignee: "Alex" }) => {
            const task = deps.workspace.createTask({
              projectId: input.projectId,
              title: args.title,
              assignee: args.assignee,
              status: "assigned",
              createdByMessageId: mikeMessageId,
            });
            createdTaskId = task.id;
            deps.workspace.updateMessage(mikeMessageId, { taskId: task.id });
            deps.bus.publish({ type: "task.created", task });
            emitTask(emit, task);
            return {
              taskId: task.id,
              title: task.title,
              assignee: task.assignee,
            };
          },
        };

        const mikeResult = await runTurn({
          llm: deps.llm,
          agent: deps.leader,
          port: taskPort,
          history: historyForProject(deps.workspace, input.projectId),
          maxToolRounds: deps.maxToolRounds,
          ...mikeCallbacks,
        });

        const mikeText = mikeResult.assistantText || "（无回复内容）";
        deps.workspace.updateMessage(mikeMessageId, {
          content: mikeText,
          process: mikeResult.process,
        });

        if (!createdTaskId) {
          emit({
            type: "error",
            message: "团队领导未创建任务，无法继续执行",
          });
          return;
        }

        const task = deps.workspace.getTask(createdTaskId);
        if (!task) {
          emit({ type: "error", message: "任务不存在" });
          return;
        }

        const alexOutcome = await runAlexForTask({
          projectId: input.projectId,
          ownerUserId: input.ownerUserId,
          task,
          deps,
          emit,
        });

        emit({
          type: "done",
          messageId: alexOutcome.messageId,
          filesChanged: alexOutcome.filesChanged,
          previewEnqueued: alexOutcome.previewEnqueued,
          taskId: createdTaskId,
        });
      } catch (err) {
        const msg =
          "生成失败：" +
          (err instanceof Error ? err.message : "未知错误").slice(0, 300);
        if (mikeMessageId) {
          const current = deps.workspace
            .listMessages(input.projectId)
            .find((m) => m.id === mikeMessageId);
          if (
            current &&
            (current.content === "" ||
              current.content === ASSISTANT_PLACEHOLDER)
          ) {
            const failurePatch =
              mikeProcess.steps.length > 0
                ? { content: msg, process: mikeProcess }
                : { content: msg };
            deps.workspace.updateMessage(mikeMessageId, failurePatch);
          }
        }
        failTask(deps, createdTaskId, msg, emit);
        emit({ type: "error", message: msg });
      } finally {
        releaseTurnLock(input.projectId);
      }
    },
  };
}

export async function retryStuckAssignedTask(
  task: Task,
  deps: TeamTurnDeps,
): Promise<{ ok: boolean; error?: string }> {
  if (!tryAcquireTurnLock(task.projectId)) {
    return { ok: false, error: "conflict" };
  }
  try {
    const latest = deps.workspace.getTask(task.id);
    if (!latest || latest.status !== "assigned") {
      return { ok: false, error: "not_assigned" };
    }
    const project = deps.workspace.getProject(task.projectId);
    if (!project) {
      return { ok: false, error: "not_found" };
    }
    await runAlexForTask({
      projectId: task.projectId,
      ownerUserId: project.ownerUserId,
      task: latest,
      deps,
      extraUserContent: `请执行任务：${latest.title}`,
    });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知错误";
    failTask(deps, task.id, message);
    return { ok: false, error: message };
  } finally {
    releaseTurnLock(task.projectId);
  }
}
