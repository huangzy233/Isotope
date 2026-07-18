import path from "node:path";

export function resolveWorkspaceRelativePath(
  workspaceRoot: string,
  relativePath: string,
): string {
  const root = path.resolve(workspaceRoot);
  const resolved = path.resolve(root, relativePath);
  const rel = path.relative(root, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Invalid path");
  }
  return resolved;
}
