import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { promptsRoot } from "./paths.js";

const FIVE_SECTIONS = ["## 身份", "## 职责", "## 流程", "## 上下文", "## 交流"];

const PROMPT_FILES = [
  "coding/alex-system.v1.md",
  "review/qa-system.v1.md",
  "leader/mike-system.v1.md",
  "leader/mike-summary.v1.md",
  "requirement/pat-system.v1.md",
];

describe("prompt five-section skeleton", () => {
  it.each(PROMPT_FILES)("%s contains the five section headers", (rel) => {
    const abs = path.join(promptsRoot(), rel);
    const body = fs.readFileSync(abs, "utf8");
    for (const heading of FIVE_SECTIONS) {
      expect(body, `${rel} missing ${heading}`).toContain(heading);
    }
  });
});
