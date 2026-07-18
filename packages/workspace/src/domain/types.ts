export type ProjectMode = "engineer" | "team";

export type Project = {
  id: string;
  name: string;
  mode: ProjectMode;
  ownerUserId: string;
  createdAt: string;
  updatedAt: string;
};

export type MessageRole = "user" | "assistant" | "system";

export type Message = {
  id: string;
  projectId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  agentName?: string;
};
