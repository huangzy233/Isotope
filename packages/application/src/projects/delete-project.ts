import type { WorkspaceStore } from "@isotope/workspace";
import { getProject } from "./get-project.js";

export function deleteProject(
  input: { ownerUserId: string; projectId: string },
  workspace: WorkspaceStore,
): { ok: true } | null {
  const project = getProject(input, workspace);
  if (!project) return null;
  workspace.deleteProject(input.projectId);
  return { ok: true };
}
