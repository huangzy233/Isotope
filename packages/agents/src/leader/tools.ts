import type { LlmToolDefinition } from "@isotope/llm";

export const LEADER_TOOLS: LlmToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "create_task",
      description: "Create a task and assign it to an engineer.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Short one-line task title.",
          },
          assignee: {
            type: "string",
            enum: ["Alex"],
            description: "Engineer to assign the task to.",
          },
        },
        required: ["title", "assignee"],
      },
    },
  },
];

type TaskToolPort = {
  createTask(input: {
    title: string;
    assignee: "Alex";
  }): { taskId: string; title: string; assignee: "Alex" };
};

export function executeLeaderTool(
  name: string,
  argsJson: string,
  port: TaskToolPort,
): { ok: true; result: string } | { ok: false; error: string } {
  let args: unknown;
  try {
    args = JSON.parse(argsJson);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid JSON";
    return { ok: false, error: message };
  }

  try {
    switch (name) {
      case "create_task": {
        const title = (args as Record<string, unknown>).title;
        const assignee = (args as Record<string, unknown>).assignee;
        if (typeof title !== "string" || title.length === 0) {
          return { ok: false, error: "title is required" };
        }
        if (assignee !== "Alex") {
          return { ok: false, error: "assignee must be Alex" };
        }
        const task = port.createTask({ title, assignee });
        return { ok: true, result: JSON.stringify(task) };
      }
      default:
        return { ok: false, error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
