import type { Task, WorkspaceStore } from "@isotope/workspace";
import type { TaskEventBus } from "./task-event-bus.js";

export type TaskWatchdogDeps = {
  workspace: WorkspaceStore;
  bus: TaskEventBus;
  isTurnLocked: (projectId: string) => boolean;
  onRetryAssigned: (task: Task) => void | Promise<void>;
  intervalMs?: number;
  stuckMs?: number;
  now?: () => number;
};

export function startTaskWatchdog(deps: TaskWatchdogDeps): () => void {
  const {
    workspace,
    bus,
    isTurnLocked,
    onRetryAssigned,
    intervalMs = 3000,
    stuckMs = 90000,
    now = () => Date.now(),
  } = deps;

  const tick = async () => {
    const tasks = workspace.listTasksByStatus(["assigned", "running"]);
    const currentTime = now();

    for (const task of tasks) {
      if (isTurnLocked(task.projectId)) continue;

      const lastProgress = new Date(task.lastProgressAt).getTime();
      if (currentTime - lastProgress <= stuckMs) continue;

      if (task.status === "assigned") {
        await onRetryAssigned(task);
      } else if (task.status === "running") {
        const prevStatus = task.status;
        const updated = workspace.updateTask(task.id, { status: "failed" });
        if (updated) {
          bus.publish({ type: "task.failed", task: updated });
          bus.publish({ type: "task.updated", task: updated, prevStatus });
        }
      }
    }
  };

  const interval = setInterval(() => {
    void tick();
  }, intervalMs);

  return () => clearInterval(interval);
}
