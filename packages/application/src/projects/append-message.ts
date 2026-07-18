import type { Message, WorkspaceStore } from "@isotope/workspace";
import { getProject } from "./get-project.js";
import { ASSISTANT_PLACEHOLDER } from "./placeholder.js";

export function appendMessage(
  input: { ownerUserId: string; projectId: string; content: string },
  workspace: WorkspaceStore,
): { messages: [Message, Message] } | null {
  if (!getProject(input, workspace)) {
    return null;
  }

  const user = workspace.appendMessage({
    projectId: input.projectId,
    role: "user",
    content: input.content,
  });
  const assistant = workspace.appendMessage({
    projectId: input.projectId,
    role: "assistant",
    content: ASSISTANT_PLACEHOLDER,
    agentName: "Alex",
  });

  return { messages: [user, assistant] };
}
