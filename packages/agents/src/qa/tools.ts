import type { LlmToolDefinition } from "@isotope/llm";

export const QA_TOOLS: LlmToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "run_check",
      description:
        "Run typecheck in the project workspace and return ok status plus log output.",
      parameters: {
        type: "object",
        properties: {},
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
];

export type QaToolPort = {
  listFiles(relativeDir?: string): string[];
  readFile(relativePath: string): string;
  runCheck():
    | Promise<{ ok: boolean; log: string }>
    | { ok: boolean; log: string };
};

export type QaToolOutcome =
  | { ok: true; result: string }
  | { ok: false; error: string };

export async function executeQaTool(
  name: string,
  argsJson: string,
  port: QaToolPort,
): Promise<QaToolOutcome> {
  let args: unknown;
  try {
    args = JSON.parse(argsJson);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid JSON";
    return { ok: false, error: message };
  }

  try {
    switch (name) {
      case "run_check": {
        const check = await Promise.resolve(port.runCheck());
        return {
          ok: true,
          result: JSON.stringify({ ok: check.ok, log: check.log }),
        };
      }
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
      default:
        return { ok: false, error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
