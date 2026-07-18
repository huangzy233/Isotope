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
    mode: ProjectMode;
  },
  workspace: WorkspaceStore,
): { project: Project; messages: Message[] } {
  const requirement = input.requirement.trim();
  if (!requirement) {
    throw new Error("需求不能为空");
  }
  if (!MODES.has(input.mode)) {
    throw new Error("模式无效，请选择 engineer 或 team");
  }

  const project = workspace.createProject({
    ownerUserId: input.ownerUserId,
    name: deriveProjectName(requirement),
    mode: input.mode,
  });

  const user = workspace.appendMessage({
    projectId: project.id,
    role: "user",
    content: requirement,
  });
  const assistant = workspace.appendMessage({
    projectId: project.id,
    role: "assistant",
    content: ASSISTANT_PLACEHOLDER,
    agentName: "Alex",
  });

  return { project, messages: [user, assistant] };
}
