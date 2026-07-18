import type { LlmToolDefinition } from "@isotope/llm";

export const REQUIREMENT_TOOLS: LlmToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "confirm_requirement",
      description:
        "Confirm the finalized requirement summary after the user explicitly approves it.",
      parameters: {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description: "Concise requirement summary agreed with the user.",
          },
        },
        required: ["summary"],
      },
    },
  },
];

type ConfirmRequirementPort = {
  confirmRequirement(
    summary: string,
  ): { ok: true } | { ok: false; error: string };
};

export function executeRequirementTool(
  name: string,
  argsJson: string,
  port: ConfirmRequirementPort,
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
      case "confirm_requirement": {
        const summary = (args as Record<string, unknown>).summary;
        if (typeof summary !== "string" || summary.trim().length === 0) {
          return { ok: false, error: "summary is required" };
        }
        const confirmed = port.confirmRequirement(summary);
        if (!confirmed.ok) {
          return { ok: false, error: confirmed.error };
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
