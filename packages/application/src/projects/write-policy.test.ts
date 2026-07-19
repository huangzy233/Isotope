import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createWritePolicyPort,
  isPathAllowed,
  loadWritePolicy,
} from "./write-policy.js";

describe("write-policy", () => {
  it("allows src and index.html, denies config and memory", () => {
    const policy = { allow: ["src/**", "index.html"] };
    expect(isPathAllowed(policy, "src/App.tsx")).toBe(true);
    expect(isPathAllowed(policy, "src/components/Button.tsx")).toBe(true);
    expect(isPathAllowed(policy, "index.html")).toBe(true);
    expect(isPathAllowed(policy, "vite.config.ts")).toBe(false);
    expect(isPathAllowed(policy, "package.json")).toBe(false);
    expect(isPathAllowed(policy, ".project/memory/decisions.md")).toBe(false);
  });

  it("rejects path traversal that would escape allow list after normalize", () => {
    const policy = { allow: ["src/**", "index.html"] };
    expect(isPathAllowed(policy, "src/../package.json")).toBe(false);
    expect(isPathAllowed(policy, "src/foo/../../vite.config.ts")).toBe(false);
    expect(isPathAllowed(policy, "src/App.tsx")).toBe(true);
    expect(isPathAllowed(policy, "index.html")).toBe(true);

    const writes: string[] = [];
    const port = createWritePolicyPort(policy, {
      writeFile: (p: string) => {
        writes.push(p);
      },
    });
    expect(() => port.writeFile("src/../package.json", "x")).toThrow(
      /不允许修改/,
    );
    expect(() =>
      port.writeFile("src/foo/../../vite.config.ts", "x"),
    ).toThrow(/不允许修改/);
    expect(writes).toEqual([]);
  });

  it("createWritePolicyPort blocks denied writes", () => {
    const writes: string[] = [];
    const port = createWritePolicyPort(
      { allow: ["src/**", "index.html"] },
      {
        writeFile: (p: string, c: string) => {
          writes.push(p);
        },
      },
    );
    port.writeFile("src/App.tsx", "x");
    expect(writes).toEqual(["src/App.tsx"]);
    expect(() => port.writeFile("vite.config.ts", "x")).toThrow(/不允许修改/);
  });

  it("loadWritePolicy reads yaml allow list", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wp-"));
    const file = path.join(dir, "write-policy.yaml");
    fs.writeFileSync(file, "allow:\n  - \"src/**\"\n  - \"index.html\"\n");
    expect(loadWritePolicy(file).allow).toEqual(["src/**", "index.html"]);
  });
});
