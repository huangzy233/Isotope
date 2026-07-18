import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFsSqliteWorkspace } from "@isotope/workspace";
import { appendMessage } from "./append-message.js";
import { createProject } from "./create-project.js";
import { deleteProject } from "./delete-project.js";
import { getProject } from "./get-project.js";
import { listMessages } from "./list-messages.js";
import { listProjects } from "./list-projects.js";
import { ASSISTANT_PLACEHOLDER } from "./placeholder.js";
import { updateProjectFlags } from "./update-project-flags.js";
import { updateProjectMode } from "./update-project-mode.js";

const templatePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../templates/vite-react",
);

describe("project use cases", () => {
  let dataRoot: string;
  let workspace: ReturnType<typeof createFsSqliteWorkspace>;

  beforeEach(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "iso-app-"));
    workspace = createFsSqliteWorkspace({ dataRoot, templatePath });
  });

  afterEach(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  it("createProject seeds user + assistant messages", () => {
    const { project, messages } = createProject(
      {
        ownerUserId: "demo",
        requirement: "做一个待办清单",
        mode: "engineer",
      },
      workspace,
    );
    expect(project.name).toContain("待办");
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe("user");
    expect(messages[1]?.content).toBe(ASSISTANT_PLACEHOLDER);
    expect(messages[1]?.agentName).toBe("Alex");
    expect(listProjects({ ownerUserId: "demo" }, workspace)).toHaveLength(1);
  });

  it("createProject team seeds Mike placeholder", () => {
    const { messages } = createProject(
      {
        ownerUserId: "demo",
        requirement: "做一个团队项目",
        mode: "team",
      },
      workspace,
    );
    expect(messages[1]?.content).toBe(ASSISTANT_PLACEHOLDER);
    expect(messages[1]?.agentName).toBe("Mike");
  });

  it("createProject planEnabled seeds Pat placeholder", () => {
    const { project, messages } = createProject(
      {
        ownerUserId: "demo",
        requirement: "做一个待办清单",
        planEnabled: true,
      },
      workspace,
    );
    expect(project.planEnabled).toBe(true);
    expect(project.teamEnabled).toBe(false);
    expect(messages[1]?.agentName).toBe("Pat");
    expect(messages[1]?.content).toBe(ASSISTANT_PLACEHOLDER);
  });

  it("updateProjectFlags updates plan/team; updateProjectMode maps teamEnabled", () => {
    const { project } = createProject(
      {
        ownerUserId: "demo",
        requirement: "x",
        mode: "engineer",
      },
      workspace,
    );
    const withPlan = updateProjectFlags(
      {
        ownerUserId: "demo",
        projectId: project.id,
        planEnabled: true,
      },
      workspace,
    );
    expect(withPlan?.planEnabled).toBe(true);
    expect(withPlan?.teamEnabled).toBe(false);

    const withTeam = updateProjectMode(
      {
        ownerUserId: "demo",
        projectId: project.id,
        mode: "team",
      },
      workspace,
    );
    expect(withTeam?.teamEnabled).toBe(true);
    expect(withTeam?.mode).toBe("team");
  });

  it("hides other users projects", () => {
    const { project } = createProject(
      { ownerUserId: "demo", requirement: "x", mode: "team" },
      workspace,
    );
    expect(getProject({ ownerUserId: "reviewer", projectId: project.id }, workspace)).toBeNull();
    expect(listMessages({ ownerUserId: "reviewer", projectId: project.id }, workspace)).toBeNull();
    expect(
      appendMessage(
        { ownerUserId: "reviewer", projectId: project.id, content: "hi" },
        workspace,
      ),
    ).toBeNull();
  });

  it("appendMessage adds user + placeholder assistant", () => {
    const { project } = createProject(
      { ownerUserId: "demo", requirement: "x", mode: "engineer" },
      workspace,
    );
    const result = appendMessage(
      { ownerUserId: "demo", projectId: project.id, content: "继续" },
      workspace,
    );
    expect(result?.messages).toHaveLength(2);
    const all = listMessages({ ownerUserId: "demo", projectId: project.id }, workspace);
    expect(all?.length).toBe(4);
  });

  it("deleteProject enforces ownership and removes project", () => {
    const { project } = createProject(
      { ownerUserId: "demo", requirement: "x", mode: "engineer" },
      workspace,
    );
    expect(
      deleteProject(
        { ownerUserId: "reviewer", projectId: project.id },
        workspace,
      ),
    ).toBeNull();
    expect(
      deleteProject({ ownerUserId: "demo", projectId: project.id }, workspace),
    ).toEqual({ ok: true });
    expect(
      getProject({ ownerUserId: "demo", projectId: project.id }, workspace),
    ).toBeNull();
  });
});
