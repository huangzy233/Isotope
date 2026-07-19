import type { LlmToolDefinition } from "@isotope/llm";

const PREFERENCE_KEYS = [
  "ui_language",
  "explanation_verbosity",
  "code_style_notes",
] as const;

export const CODER_TOOLS: LlmToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "list_files",
      description: "List files in the workspace, optionally under a relative directory.",
      parameters: {
        type: "object",
        properties: {
          relativeDir: {
            type: "string",
            description: "Relative directory to list (defaults to workspace root).",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read the contents of a file in the workspace.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Relative path to the file (e.g. src/App.tsx).",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Write content to a file in the workspace.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Relative path to the file (e.g. src/App.tsx).",
          },
          content: {
            type: "string",
            description: "Full file content to write.",
          },
        },
        required: ["path", "content"],
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

type ToolPort = {
  listFiles(relativeDir?: string): string[];
  readFile(relativePath: string): string;
  writeFile(relativePath: string, content: string): void;
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

export function executeTool(
  name: string,
  argsJson: string,
  port: ToolPort,
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
      case "list_files": {
        const relativeDir =
          typeof (args as Record<string, unknown>).relativeDir === "string"
            ? (args as { relativeDir: string }).relativeDir
            : undefined;
        const files = port.listFiles(relativeDir);
        return { ok: true, result: JSON.stringify(files) };
      }
      case "read_file": {
        const path = (args as Record<string, unknown>).path;
        if (typeof path !== "string" || path.length === 0) {
          return { ok: false, error: "path is required" };
        }
        const content = port.readFile(path);
        return { ok: true, result: content };
      }
      case "write_file": {
        const path = (args as Record<string, unknown>).path;
        const content = (args as Record<string, unknown>).content;
        if (typeof path !== "string" || path.length === 0) {
          return { ok: false, error: "path is required" };
        }
        if (typeof content !== "string") {
          return { ok: false, error: "content is required" };
        }
        port.writeFile(path, content);
        return { ok: true, result: "ok" };
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
