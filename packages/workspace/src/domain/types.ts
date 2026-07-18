export type ProjectMode = "engineer" | "team";

export type Project = {
  id: string;
  name: string;
  /** @deprecated 派生自 teamEnabled，勿作 Plan 真相源 */
  mode: ProjectMode;
  planEnabled: boolean;
  teamEnabled: boolean;
  planConfirmed: boolean;
  confirmedRequirement?: string;
  ownerUserId: string;
  createdAt: string;
  updatedAt: string;
};

export type MessageRole = "user" | "assistant" | "system";

export type MessageProcessStep =
  | { type: "thinking"; text: string }
  | {
      type: "tool";
      id: string;
      name: string;
      status: "running" | "done" | "error";
      summary?: string;
    };

export type MessageProcess = { steps: MessageProcessStep[] };

export type TaskStatus =
  | "pending"
  | "assigned"
  | "running"
  | "completed"
  | "failed";

export type Task = {
  id: string;
  projectId: string;
  title: string;
  assignee: "Alex";
  status: TaskStatus;
  createdByMessageId?: string;
  assigneeMessageId?: string;
  createdAt: string;
  updatedAt: string;
  lastProgressAt: string;
};

export type Message = {
  id: string;
  projectId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  agentName?: string;
  process?: MessageProcess;
  taskId?: string;
  versionId?: string;
  versionNumber?: number;
};

export type Version = {
  id: string;
  projectId: string;
  number: number;
  summary: string;
  previewRevision: string | null;
  snapshotRef: string | null;
  createdAt: string;
};
