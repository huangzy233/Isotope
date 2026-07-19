import type { LlmToolDefinition } from "@isotope/llm";

const PREFERENCE_KEYS = [
  "ui_language",
  "explanation_verbosity",
  "code_style_notes",
] as const;

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
  {
    type: "function",
    function: {
      name: "set_preference",
      description:
        "Save a user preference for future projects (ui_language | explanation_verbosity | code_style_notes).",
      parameters: {
        type: "object",
        properties: {
          key: {
            type: "string",
            enum: [...PREFERENCE_KEYS],
          },
          value: { type: "string" },
        },
        required: ["key", "value"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remember_decision",
      description: "Append a product decision to project long-term memory.",
      parameters: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "One-line decision.",
          },
        },
        required: ["text"],
      },
    },
  },
];

type TaskToolPort = {
  createTask(input: {
    title: string;
    assignee: "Alex";
  }): { taskId: string; title: string; assignee: "Alex" };
  setPreference(
    key: string,
    value: string,
  ): { ok: true } | { ok: false; error: string };
  rememberDecision(
    text: string,
  ): { ok: true } | { ok: false; error: string };
};

function isPreferenceKey(key: string): boolean {
  return (PREFERENCE_KEYS as readonly string[]).includes(key);
}

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
      case "set_preference": {
        const key = (args as Record<string, unknown>).key;
        const value = (args as Record<string, unknown>).value;
        if (typeof key !== "string" || key.length === 0) {
          return { ok: false, error: "key is required" };
        }
        if (typeof value !== "string") {
          return { ok: false, error: "value is required" };
        }
        if (!isPreferenceKey(key)) {
          return { ok: false, error: "unknown key" };
        }
        const saved = port.setPreference(key, value);
        if (!saved.ok) {
          return { ok: false, error: saved.error };
        }
        return { ok: true, result: "ok" };
      }
      case "remember_decision": {
        const text = (args as Record<string, unknown>).text;
        if (typeof text !== "string" || text.trim().length === 0) {
          return { ok: false, error: "text is required" };
        }
        const remembered = port.rememberDecision(text);
        if (!remembered.ok) {
          return { ok: false, error: remembered.error };
        }
        return { ok: true, result: "ok" };
      }
      default:
        return { ok: false, error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
