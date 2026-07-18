import fs from "node:fs";
import path from "node:path";
import { resolveWorkspaceRelativePath } from "../domain/paths.js";

export function copyTemplate(
  templatePath: string,
  projectWorkspaceDir: string,
): void {
  fs.cpSync(templatePath, projectWorkspaceDir, { recursive: true });
}

export function ensureBuildDir(projectBuildDir: string): void {
  fs.mkdirSync(projectBuildDir, { recursive: true });
}

export function readWorkspaceFile(
  workspaceRoot: string,
  relativePath: string,
): string {
  return fs.readFileSync(
    resolveWorkspaceRelativePath(workspaceRoot, relativePath),
    "utf8",
  );
}

export function writeWorkspaceFile(
  workspaceRoot: string,
  relativePath: string,
  content: string,
): void {
  const targetPath = resolveWorkspaceRelativePath(workspaceRoot, relativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content, "utf8");
}

export function listWorkspaceFiles(
  workspaceRoot: string,
  relativeDir = "",
): string[] {
  const directory = resolveWorkspaceRelativePath(workspaceRoot, relativeDir);
  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs
    .readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path
        .relative(workspaceRoot, path.join(entry.parentPath, entry.name))
        .split(path.sep)
        .join("/"),
    )
    .sort();
}
