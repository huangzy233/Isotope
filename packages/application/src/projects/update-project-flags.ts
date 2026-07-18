import type { Project, WorkspaceStore } from "@isotope/workspace";
import { getProject } from "./get-project.js";

export function updateProjectFlags(
  input: {
    ownerUserId: string;
    projectId: string;
    planEnabled?: boolean;
    teamEnabled?: boolean;
  },
  workspace: WorkspaceStore,
): Project | null {
  if (
    !getProject(
      { ownerUserId: input.ownerUserId, projectId: input.projectId },
      workspace,
    )
  ) {
    return null;
  }
  const patch: { planEnabled?: boolean; teamEnabled?: boolean } = {};
  if (input.planEnabled !== undefined) {
    patch.planEnabled = input.planEnabled;
  }
  if (input.teamEnabled !== undefined) {
    patch.teamEnabled = input.teamEnabled;
  }
  if (Object.keys(patch).length > 0) {
    workspace.updateProjectMeta(input.projectId, patch);
  }
  return workspace.getProject(input.projectId);
}
