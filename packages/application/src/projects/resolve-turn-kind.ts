export type TurnKind = "plan_clarify" | "team" | "engineer";

export function resolveTurnKind(p: {
  planEnabled: boolean;
  teamEnabled: boolean;
  planConfirmed: boolean;
}): TurnKind {
  if (p.planEnabled && !p.planConfirmed) return "plan_clarify";
  if (p.teamEnabled) return "team";
  return "engineer";
}
