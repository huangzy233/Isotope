import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveWorkspaceRelativePath } from "./paths.js";

describe("resolveWorkspaceRelativePath", () => {
  const root = path.join("/tmp", "ws-root");
  it("resolves a safe relative path", () => {
    expect(resolveWorkspaceRelativePath(root, "src/App.tsx")).toBe(
      path.join(root, "src/App.tsx"),
    );
  });
  it("rejects escape", () => {
    expect(() => resolveWorkspaceRelativePath(root, "../secret")).toThrow(
      /Invalid path/,
    );
  });
});
