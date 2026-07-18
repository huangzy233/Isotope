import type { Project, ProjectMode, WorkspaceStore } from "@isotope/workspace";
import { getProject } from "./get-project.js";

export function updateProjectMode(
  input: { ownerUserId: string; projectId: string; mode: ProjectMode },
  workspace: WorkspaceStore,
): Project | null {
  if (!getProject(
    { ownerUserId: input.ownerUserId, projectId: input.projectId },
    workspace,
  )) {
    return null;
  }
  workspace.updateProjectMeta(input.projectId, { mode: input.mode });
  return workspace.getProject(input.projectId);
}
