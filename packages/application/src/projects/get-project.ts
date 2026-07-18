import type { Project, WorkspaceStore } from "@isotope/workspace";

export function getProject(
  input: { ownerUserId: string; projectId: string },
  workspace: WorkspaceStore,
): Project | null {
  const project = workspace.getProject(input.projectId);
  if (!project || project.ownerUserId !== input.ownerUserId) {
    return null;
  }
  return project;
}
