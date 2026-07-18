import type { WorkspaceStore } from "@isotope/workspace";
import { getProject } from "./get-project.js";
import { isNoisyWorkspacePath } from "./workspace-source-noise.js";

export function listWorkspaceSourceFiles(
  input: { ownerUserId: string; projectId: string },
  workspace: WorkspaceStore,
): string[] | null {
  if (!getProject(input, workspace)) {
    return null;
  }
  return workspace
    .listFiles(input.projectId)
    .filter((p) => !isNoisyWorkspacePath(p))
    .sort();
}
