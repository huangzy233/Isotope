import { describe, expect, it } from "vitest";
import { deriveProjectName } from "./project-name.js";

describe("deriveProjectName", () => {
  it("trims and collapses whitespace", () => {
    expect(deriveProjectName("  做一个\n待办  ")).toBe("做一个 待办");
  });
  it("truncates to 32 chars with ellipsis", () => {
    const long = "一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十多余字";
    const name = deriveProjectName(long);
    expect(name.endsWith("…")).toBe(true);
    expect([...name.replace(/…$/, "")].length).toBe(32);
  });
  it("falls back for empty", () => {
    expect(deriveProjectName("   ")).toBe("未命名项目");
  });
});
