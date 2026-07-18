const MAX = 32;

export function deriveProjectName(requirement: string): string {
  const collapsed = requirement.trim().replace(/\s+/g, " ");
  if (!collapsed) return "未命名项目";
  const chars = [...collapsed];
  if (chars.length <= MAX) return collapsed;
  return chars.slice(0, MAX).join("") + "…";
}
