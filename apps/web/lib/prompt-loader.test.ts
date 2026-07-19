import { describe, expect, it } from "vitest";
import { createPromptLoader } from "./prompt-loader.js";

describe("createPromptLoader", () => {
  it("loads md+meta and uses model from meta", () => {
    const files = new Map<string, string>([
      [
        "/prompts/leader/mike-system.v1.md",
        "You are Mike.",
      ],
      [
        "/prompts/leader/mike-system.v1.meta.yaml",
        [
          "id: leader/mike-system",
          "version: v1",
          "model: meta-model",
          "tools:",
          "  - create_task",
        ].join("\n"),
      ],
    ]);
    const mtimes = new Map<string, number>([
      ["/prompts/leader/mike-system.v1.md", 1],
      ["/prompts/leader/mike-system.v1.meta.yaml", 1],
    ]);

    const loader = createPromptLoader({
      promptsRoot: "/prompts",
      defaultModel: "default-model",
      readFile: (abs) => {
        const content = files.get(abs);
        if (content === undefined) throw new Error(`ENOENT: ${abs}`);
        return content;
      },
      statMtimeMs: (abs) => {
        const mtime = mtimes.get(abs);
        if (mtime === undefined) throw new Error(`ENOENT: ${abs}`);
        return mtime;
      },
    });

    expect(loader.load("leader/mike-system", "v1")).toEqual({
      id: "leader/mike-system",
      version: "v1",
      system: "You are Mike.",
      model: "meta-model",
      tools: ["create_task"],
    });
  });

  it("falls back to defaultModel when meta omits model", () => {
    const files = new Map<string, string>([
      ["/prompts/coding/alex-system.v1.md", "You are Alex."],
      [
        "/prompts/coding/alex-system.v1.meta.yaml",
        [
          "id: coding/alex-system",
          "version: v1",
          "tools:",
          "  - list_files",
        ].join("\n"),
      ],
    ]);

    const loader = createPromptLoader({
      promptsRoot: "/prompts",
      defaultModel: "default-model",
      readFile: (abs) => {
        const content = files.get(abs);
        if (content === undefined) throw new Error(`ENOENT: ${abs}`);
        return content;
      },
      statMtimeMs: () => 1,
    });

    expect(loader.load("coding/alex-system").model).toBe("default-model");
  });

  it("caches by mtime and rereads when mtime changes", () => {
    const files = new Map<string, string>([
      ["/prompts/leader/mike-summary.v1.md", "Summary v1"],
      [
        "/prompts/leader/mike-summary.v1.meta.yaml",
        ["id: leader/mike-summary", "version: v1", "tools: []"].join("\n"),
      ],
    ]);
    const mtimes = new Map<string, number>([
      ["/prompts/leader/mike-summary.v1.md", 10],
      ["/prompts/leader/mike-summary.v1.meta.yaml", 10],
    ]);
    let reads = 0;

    const loader = createPromptLoader({
      promptsRoot: "/prompts",
      defaultModel: "default-model",
      readFile: (abs) => {
        reads += 1;
        const content = files.get(abs);
        if (content === undefined) throw new Error(`ENOENT: ${abs}`);
        return content;
      },
      statMtimeMs: (abs) => {
        const mtime = mtimes.get(abs);
        if (mtime === undefined) throw new Error(`ENOENT: ${abs}`);
        return mtime;
      },
    });

    expect(loader.load("leader/mike-summary").system).toBe("Summary v1");
    const afterFirst = reads;
    expect(loader.load("leader/mike-summary").system).toBe("Summary v1");
    expect(reads).toBe(afterFirst);

    files.set("/prompts/leader/mike-summary.v1.md", "Summary v2");
    mtimes.set("/prompts/leader/mike-summary.v1.md", 20);
    expect(loader.load("leader/mike-summary").system).toBe("Summary v2");
    expect(reads).toBeGreaterThan(afterFirst);
  });

  it("throws when md or meta is missing", () => {
    const loader = createPromptLoader({
      promptsRoot: "/prompts",
      defaultModel: "default-model",
      readFile: () => {
        throw new Error("ENOENT");
      },
      statMtimeMs: () => 1,
    });

    expect(() => loader.load("leader/missing")).toThrow();

    const onlyMd = createPromptLoader({
      promptsRoot: "/prompts",
      defaultModel: "default-model",
      readFile: (abs) => {
        if (abs.endsWith(".md")) return "ok";
        throw new Error(`ENOENT: ${abs}`);
      },
      statMtimeMs: () => 1,
    });
    expect(() => onlyMd.load("leader/mike-system")).toThrow();
  });
});
