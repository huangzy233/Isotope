import type { WorkspaceStore } from "@isotope/workspace";
import {
  DECISIONS_FILE_MAX,
  DECISIONS_PATH,
} from "./project-memory-paths.js";

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

/** Split decisions.md into `## …` sections (same rule as buildTurnContext). */
export function splitDecisionSections(raw: string): string[] {
  return raw.split(/(?=^## )/m).filter((s) => s.trim().length > 0);
}

function joinDecisionSections(sections: string[]): string {
  if (sections.length === 0) return "";
  return (
    sections
      .map((s) => s.replace(/^\n+/, "").replace(/\s+$/, ""))
      .join("\n") + "\n"
  );
}

export function appendDecision(
  workspace: WorkspaceStore,
  projectId: string,
  text: string,
  nowIso?: string,
  fileMax: number = DECISIONS_FILE_MAX,
): void {
  const existing = readExistingDecisions(workspace, projectId);
  const timestamp = nowIso ?? new Date().toISOString();
  const section = `## ${timestamp}\n${text.trim()}`;
  const sections = [...splitDecisionSections(existing), section];
  const kept =
    sections.length > fileMax ? sections.slice(-fileMax) : sections;
  workspace.writeFile(projectId, DECISIONS_PATH, joinDecisionSections(kept));
}
