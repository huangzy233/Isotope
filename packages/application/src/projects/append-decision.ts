import type { WorkspaceStore } from "@isotope/workspace";
import { DECISIONS_PATH } from "./project-memory-paths.js";

function readExistingDecisions(
  workspace: WorkspaceStore,
  projectId: string,
): string {
  try {
    return workspace.readFile(projectId, DECISIONS_PATH);
  } catch (err) {
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? (err as { code?: string }).code
        : undefined;
    const message = err instanceof Error ? err.message : String(err);
    if (code === "ENOENT" || /ENOENT|no such file/i.test(message)) {
      return "";
    }
    throw err;
  }
}

export function appendDecision(
  workspace: WorkspaceStore,
  projectId: string,
  text: string,
  nowIso?: string,
): void {
  const existing = readExistingDecisions(workspace, projectId);
  const timestamp = nowIso ?? new Date().toISOString();
  const section = `\n## ${timestamp}\n${text.trim()}\n`;
  workspace.writeFile(projectId, DECISIONS_PATH, existing + section);
}
