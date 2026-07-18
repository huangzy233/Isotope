import type { LlmToolDefinition } from "@isotope/llm";

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
];

type ToolPort = {
  listFiles(relativeDir?: string): string[];
  readFile(relativePath: string): string;
  writeFile(relativePath: string, content: string): void;
};

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
      default:
        return { ok: false, error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
