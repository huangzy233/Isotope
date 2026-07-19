import { runTurn } from "@isotope/agent-runtime";
import type { CoderAgent, LeaderAgent, TaskToolPort } from "@isotope/agents";
import type { LlmClient } from "@isotope/llm";
import type { PreferenceStore } from "@isotope/memory";
import type { PreviewService } from "@isotope/preview";
import type {
  MessageProcess,
  Task,
  TaskStatus,
  WorkspaceStore,
} from "@isotope/workspace";
import { buildTurnContext } from "./build-turn-context.js";
import { checkpointProcess } from "./checkpoint-process.js";
import { enqueuePreviewBuild } from "./enqueue-preview-build.js";
import { getProject } from "./get-project.js";
import {
  createPlanGatedWritePort,
  isPlanClarifyGateOpen,
} from "./plan-gate.js";
import { ASSISTANT_PLACEHOLDER } from "./placeholder.js";
import type { TaskEventBus } from "./task-event-bus.js";
import type { EngineerTurnInput } from "./stream-engineer-turn.js";
import { isTransportDisconnectError } from "./transport-error.js";
import {
  destroyTurnHub,
  ensureTurnHub,
  publishTurnEvent,
} from "./turn-hub.js";
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
  preferences: PreferenceStore;
  preview: PreviewService;
  llm: LlmClient;
  leader: LeaderAgent;
  leaderModel: string;
  /** Mike 收尾总结用 agent（tools 可为空）；由装配注入 */
  leaderSummary: LeaderAgent;
  leaderSummaryModel: string;
  coder: CoderAgent;
  coderModel: string;
  bus: TaskEventBus;
  maxToolRounds: number;
};

const OPEN_TASK_STATUSES = new Set<TaskStatus>([
  "pending",
  "assigned",
  "running",
]);

function hasOpenTasks(workspace: WorkspaceStore, projectId: string): boolean {
  return workspace
    .listTasks(projectId)
    .some((t) => OPEN_TASK_STATUSES.has(t.status));
}

export type BeginTeamTurnResult =
  | { ok: false; status: "not_found" | "bad_request" | "conflict" }
  | {
      ok: true;
      run: () => Promise<void>;
    };

function historyForProject(
  deps: TeamTurnDeps,
  projectId: string,
  ownerUserId: string,
): Array<{ role: "user" | "assistant"; content: string }> {
  const project = deps.workspace.getProject(projectId);
  if (!project) return [];
  const { history } = buildTurnContext({
    messages: deps.workspace.listMessages(projectId),
    project,
    preferences: deps.preferences.getPreferences(ownerUserId),
    readProjectFile: (p) => {
      try {
        return deps.workspace.readFile(projectId, p);
      } catch {
        return null;
      }
    },
  });
  return history;
}

function trackProcess(
  process: MessageProcess,
  publish: (event: TeamTurnEvent) => void,
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

function emitTask(
  publish: (event: TeamTurnEvent) => void,
  task: Task,
): void {
  publish({
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
  publish?: (event: TeamTurnEvent) => void,
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
    if (publish) emitTask(publish, failed);
  }
}

async function runAlexForTask(input: {
  projectId: string;
  ownerUserId: string;
  task: Task;
  deps: TeamTurnDeps;
  publish?: (event: TeamTurnEvent) => void;
  extraUserContent?: string;
}): Promise<{ messageId: string; filesChanged: boolean; previewEnqueued: boolean }> {
  const { projectId, ownerUserId, task, deps, publish, extraUserContent } = input;
  const prevStatus = task.status;
  const running = deps.workspace.updateTask(task.id, { status: "running" });
  if (!running) {
    throw new Error("任务不存在");
  }
  deps.bus.publish({ type: "task.updated", task: running, prevStatus });
  if (publish) {
    emitTask(publish, running);
  }

  const alexMsg = deps.workspace.appendMessage({
    projectId,
    role: "assistant",
    content: ASSISTANT_PLACEHOLDER,
    agentName: "Alex",
    taskId: task.id,
  });
  deps.workspace.updateTask(task.id, { assigneeMessageId: alexMsg.id });
  publish?.({ type: "speaker", agentName: "Alex", messageId: alexMsg.id });

  const process: MessageProcess = { steps: [] };
  const checkpoint = () =>
    checkpointProcess(deps.workspace, alexMsg.id, process);
  const callbacks = trackProcess(
    process,
    publish ?? (() => {}),
    checkpoint,
  );

  const history = historyForProject(deps, projectId, ownerUserId);
  if (extraUserContent) {
    history.push({ role: "user", content: extraUserContent });
  }

  const project = deps.workspace.getProject(projectId);
  const basePort = {
    listFiles: (dir?: string) => deps.workspace.listFiles(projectId, dir),
    readFile: (p: string) => deps.workspace.readFile(projectId, p),
    writeFile: (p: string, c: string) =>
      deps.workspace.writeFile(projectId, p, c),
  };
  const filePort = project
    ? createPlanGatedWritePort(project, basePort)
    : basePort;

  try {
    const result = await runTurn({
      llm: deps.llm,
      model: deps.coderModel,
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
      if (publish) {
        emitTask(publish, completed);
      }
    }

    let previewEnqueued = false;
    if (result.filesChanged) {
      const latest = deps.workspace.getProject(projectId) ?? project;
      if (!latest || !isPlanClarifyGateOpen(latest)) {
        enqueuePreviewBuild(
          { ownerUserId, projectId },
          deps.workspace,
          deps.preview,
          { recordVersionIntent: true },
        );
        previewEnqueued = true;
      }
    }

    return {
      messageId: alexMsg.id,
      filesChanged: result.filesChanged,
      previewEnqueued,
    };
  } catch (err) {
    if (isTransportDisconnectError(err)) {
      throw err;
    }
    const msg =
      "生成失败：" +
      (err instanceof Error ? err.message : "未知错误").slice(0, 300);
    const failurePatch =
      process.steps.length > 0
        ? { content: msg, process }
        : { content: msg };
    deps.workspace.updateMessage(alexMsg.id, failurePatch);
    failTask(deps, task.id, msg, publish);
    throw err;
  }
}

/** 项目内无进行中任务时，追加一条 Mike 收尾总结（旁路、无工具）。 */
async function maybeRunMikeSummary(input: {
  projectId: string;
  ownerUserId: string;
  deps: TeamTurnDeps;
  publish?: (event: TeamTurnEvent) => void;
}): Promise<string | null> {
  const { projectId, ownerUserId, deps, publish } = input;
  if (hasOpenTasks(deps.workspace, projectId)) {
    return null;
  }

  const summaryMsg = deps.workspace.appendMessage({
    projectId,
    role: "assistant",
    content: "",
    agentName: "Mike",
  });
  publish?.({
    type: "speaker",
    agentName: "Mike",
    messageId: summaryMsg.id,
  });

  const process: MessageProcess = { steps: [] };
  const checkpoint = () =>
    checkpointProcess(deps.workspace, summaryMsg.id, process);
  const noopPublish = () => {};
  const callbacks = trackProcess(
    process,
    publish ?? noopPublish,
    checkpoint,
  );

  const summaryPort: TaskToolPort = {
    createTask: () => {
      throw new Error("总结回合不可创建任务");
    },
  };

  try {
    const result = await runTurn({
      llm: deps.llm,
      model: deps.leaderSummaryModel,
      agent: deps.leaderSummary,
      port: summaryPort,
      history: historyForProject(deps, projectId, ownerUserId),
      maxToolRounds: Math.min(2, deps.maxToolRounds),
      ...callbacks,
    });
    const text = result.assistantText.trim() || "本轮任务已全部完成。";
    deps.workspace.updateMessage(summaryMsg.id, {
      content: text,
      process: result.process,
    });
  } catch (err) {
    if (isTransportDisconnectError(err)) {
      return null;
    }
    const msg =
      "总结生成失败：" +
      (err instanceof Error ? err.message : "未知错误").slice(0, 300);
    deps.workspace.updateMessage(summaryMsg.id, { content: msg });
  }

  return summaryMsg.id;
}

/** 同步：归属 / 占位或 content 校验 / 加锁。失败不持锁。成功后必须调用 run（run 的 finally 释放锁）。 */
export function beginTeamTurn(
  input: EngineerTurnInput,
  deps: TeamTurnDeps,
): BeginTeamTurnResult {
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
  }

  return {
    ok: true,
    run: async () => {
      const publish = (event: TeamTurnEvent) =>
        publishTurnEvent(input.projectId, event);

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

        publish({ type: "speaker", agentName: "Mike", messageId: mikeMessageId });

        const mikeCheckpoint = () =>
          checkpointProcess(deps.workspace, mikeMessageId, mikeProcess);
        const mikeCallbacks = trackProcess(
          mikeProcess,
          publish,
          mikeCheckpoint,
        );

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
            emitTask(publish, task);
            return {
              taskId: task.id,
              title: task.title,
              assignee: task.assignee,
            };
          },
        };

        const mikeResult = await runTurn({
          llm: deps.llm,
          model: deps.leaderModel,
          agent: deps.leader,
          port: taskPort,
          history: historyForProject(
            deps,
            input.projectId,
            input.ownerUserId,
          ),
          maxToolRounds: deps.maxToolRounds,
          ...mikeCallbacks,
        });

        const mikeText = mikeResult.assistantText || "（无回复内容）";
        deps.workspace.updateMessage(mikeMessageId, {
          content: mikeText,
          process: mikeResult.process,
        });

        if (!createdTaskId) {
          publish({
            type: "error",
            message: "团队领导未创建任务，无法继续执行",
          });
          return;
        }

        const task = deps.workspace.getTask(createdTaskId);
        if (!task) {
          publish({ type: "error", message: "任务不存在" });
          return;
        }

        const alexOutcome = await runAlexForTask({
          projectId: input.projectId,
          ownerUserId: input.ownerUserId,
          task,
          deps,
          publish,
        });

        const summaryMessageId = await maybeRunMikeSummary({
          projectId: input.projectId,
          ownerUserId: input.ownerUserId,
          deps,
          publish,
        });

        publish({
          type: "done",
          messageId: summaryMessageId ?? alexOutcome.messageId,
          filesChanged: alexOutcome.filesChanged,
          previewEnqueued: alexOutcome.previewEnqueued,
          taskId: createdTaskId,
        });
      } catch (err) {
        if (isTransportDisconnectError(err)) {
          return;
        }
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
        failTask(deps, createdTaskId, msg, publish);
        publish({ type: "error", message: msg });
      } finally {
        destroyTurnHub(input.projectId);
        releaseTurnLock(input.projectId);
      }
    },
  };
}

export async function retryStuckAssignedTask(
  task: Task,
  deps: TeamTurnDeps,
): Promise<{ ok: boolean; error?: string }> {
  const bumpProgress = () => {
    deps.workspace.updateTask(task.id, {
      lastProgressAt: new Date().toISOString(),
    });
  };

  if (!tryAcquireTurnLock(task.projectId)) {
    bumpProgress();
    return { ok: false, error: "conflict" };
  }
  try {
    bumpProgress();
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
    await maybeRunMikeSummary({
      projectId: task.projectId,
      ownerUserId: project.ownerUserId,
      deps,
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
