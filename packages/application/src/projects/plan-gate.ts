import type { WorkspaceToolPort } from "@isotope/agents";

export function isPlanClarifyGateOpen(p: {
  planEnabled: boolean;
  planConfirmed: boolean;
}): boolean {
  return p.planEnabled && !p.planConfirmed;
}

export function createPlanGatedWritePort(
  project: { planEnabled: boolean; planConfirmed: boolean },
  port: WorkspaceToolPort,
): WorkspaceToolPort {
  return {
    listFiles: (relativeDir) => port.listFiles(relativeDir),
    readFile: (relativePath) => port.readFile(relativePath),
    writeFile: (relativePath, content) => {
      if (isPlanClarifyGateOpen(project)) {
        throw new Error("需求未确认，禁止改码");
      }
      port.writeFile(relativePath, content);
    },
  };
}
