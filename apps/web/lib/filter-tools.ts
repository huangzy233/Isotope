import type { LlmToolDefinition } from "@isotope/llm";

export function filterTools(
  catalog: LlmToolDefinition[],
  allowedNames: string[],
): LlmToolDefinition[] {
  if (allowedNames.length === 0) {
    return [];
  }

  const byName = new Map(catalog.map((tool) => [tool.function.name, tool]));
  for (const name of allowedNames) {
    if (!byName.has(name)) {
      throw new Error(`Unknown tool: ${name}`);
    }
  }

  const allowed = new Set(allowedNames);
  return catalog.filter((tool) => allowed.has(tool.function.name));
}
