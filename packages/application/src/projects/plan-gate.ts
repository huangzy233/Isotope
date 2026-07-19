import type { WorkspaceToolPort } from "@isotope/agents";

export function isPlanClarifyGateOpen(p: {
  planEnabled: boolean;
  planConfirmed: boolean;
}): boolean {
  return p.planEnabled && !p.planConfirmed;
}

export function createPlanGatedWritePort<T extends WorkspaceToolPort>(
  project: { planEnabled: boolean; planConfirmed: boolean },
  port: T,
): T {
  return {
    ...port,
    writeFile: (relativePath, content) => {
      if (isPlanClarifyGateOpen(project)) {
        throw new Error("需求未确认，禁止改码");
      }
      port.writeFile(relativePath, content);
    },
  };
}
