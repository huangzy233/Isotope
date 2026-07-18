import {
  deriveProjectName,
  type Message,
  type Project,
  type ProjectMode,
  type WorkspaceStore,
} from "@isotope/workspace";
import { ASSISTANT_PLACEHOLDER } from "./placeholder.js";

const MODES = new Set<ProjectMode>(["engineer", "team"]);

export function createProject(
  input: {
    ownerUserId: string;
    requirement: string;
    planEnabled?: boolean;
    teamEnabled?: boolean;
    /** @deprecated 用 teamEnabled；保留兼容 */
    mode?: ProjectMode;
  },
  workspace: WorkspaceStore,
): { project: Project; messages: Message[] } {
  const requirement = input.requirement.trim();
  if (!requirement) {
    throw new Error("需求不能为空");
  }

  const hasMode = input.mode !== undefined;
  const hasFlags =
    input.planEnabled !== undefined || input.teamEnabled !== undefined;
  if (!hasMode && !hasFlags) {
    throw new Error("请指定 mode 或 planEnabled/teamEnabled");
  }
  if (hasMode && !MODES.has(input.mode!)) {
    throw new Error("模式无效，请选择 engineer 或 team");
  }

  const planEnabled = input.planEnabled ?? false;
  const teamEnabled =
    input.teamEnabled !== undefined
      ? input.teamEnabled
      : input.mode === "team";

  const project = workspace.createProject({
    ownerUserId: input.ownerUserId,
    name: deriveProjectName(requirement),
    planEnabled,
    teamEnabled,
  });

  const agentName = planEnabled ? "Pat" : teamEnabled ? "Mike" : "Alex";

  const user = workspace.appendMessage({
    projectId: project.id,
    role: "user",
    content: requirement,
  });
  const assistant = workspace.appendMessage({
    projectId: project.id,
    role: "assistant",
    content: ASSISTANT_PLACEHOLDER,
    agentName,
  });

  return { project, messages: [user, assistant] };
}
