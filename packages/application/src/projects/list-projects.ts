import type { Project, WorkspaceStore } from "@isotope/workspace";

export function listProjects(
  input: { ownerUserId: string },
  workspace: WorkspaceStore,
): Project[] {
  return workspace.listProjects(input.ownerUserId);
}
