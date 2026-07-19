import type { Version, WorkspaceStore } from "@isotope/workspace";
import { getProject } from "./get-project.js";

export function listProjectVersions(
  input: { ownerUserId: string; projectId: string },
  workspace: WorkspaceStore,
): Version[] | null {
  if (!getProject(input, workspace)) {
    return null;
  }
  return [...workspace.listVersions(input.projectId)].reverse();
}
