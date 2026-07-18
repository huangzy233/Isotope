export function agentRoleLabel(agentName: string | undefined): string | null {
  if (agentName === "Pat") return "产品";
  if (agentName === "Mike") return "团队领导";
  if (agentName === "Alex") return "工程师";
  return null;
}
