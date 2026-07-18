export const NOISY_WORKSPACE_SEGMENTS = [
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
] as const;

export function isNoisyWorkspacePath(relativePath: string): boolean {
  return relativePath
    .split("/")
    .filter(Boolean)
    .some((segment) =>
      (NOISY_WORKSPACE_SEGMENTS as readonly string[]).includes(segment),
    );
}
