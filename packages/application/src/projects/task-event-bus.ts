import type { Task, TaskStatus } from "@isotope/workspace";

export type TaskEvent =
  | { type: "task.created"; task: Task }
  | { type: "task.updated"; task: Task; prevStatus: TaskStatus }
  | { type: "task.completed"; task: Task }
  | { type: "task.failed"; task: Task; error?: string };

export type TaskEventBus = {
  publish(event: TaskEvent): void;
  subscribe(handler: (event: TaskEvent) => void): () => void;
};

export function createTaskEventBus(): TaskEventBus {
  const handlers = new Set<(event: TaskEvent) => void>();
  return {
    publish(event) {
      for (const h of [...handlers]) h(event);
    },
    subscribe(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
  };
}
