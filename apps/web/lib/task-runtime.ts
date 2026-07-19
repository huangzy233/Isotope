import {
  createTaskEventBus,
  isTurnLocked,
  retryStuckAssignedTask,
  startTaskWatchdog,
  type TaskEventBus,
} from "@isotope/application";
import { createTeamTurnDeps } from "./agent";
import { getPreferenceStore } from "./memory";
import { getPreview } from "./preview";
import { getWorkspace } from "./workspace";

let bus: TaskEventBus | null = null;
let started = false;

export function getTaskBus(): TaskEventBus {
  if (!bus) {
    bus = createTaskEventBus();
  }
  return bus;
}

/** Idempotent: single bus + watchdog for the process. */
export function ensureTaskRuntime(): void {
  if (started) return;
  started = true;
  const taskBus = getTaskBus();
  startTaskWatchdog({
    workspace: getWorkspace(),
    bus: taskBus,
    isTurnLocked,
    onRetryAssigned: async (task) => {
      const turnDeps = createTeamTurnDeps();
      await retryStuckAssignedTask(task, {
        workspace: getWorkspace(),
        preferences: getPreferenceStore(),
        preview: getPreview(),
        bus: getTaskBus(),
        ...turnDeps,
      });
    },
  });
}
