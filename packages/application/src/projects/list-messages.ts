import type { Message, WorkspaceStore } from "@isotope/workspace";
import { getProject } from "./get-project.js";

export function listMessages(
  input: { ownerUserId: string; projectId: string },
  workspace: WorkspaceStore,
): Message[] | null {
  if (!getProject(input, workspace)) {
    return null;
  }
  return workspace.listMessages(input.projectId);
}
