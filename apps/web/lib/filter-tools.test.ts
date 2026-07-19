import { describe, expect, it } from "vitest";
import type { LlmToolDefinition } from "@isotope/llm";
import { filterTools } from "./filter-tools.js";

const CATALOG: LlmToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "list_files",
      description: "List files",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a file",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Write a file",
      parameters: { type: "object", properties: {} },
    },
  },
];

describe("filterTools", () => {
  it("returns only allowed tools in catalog order", () => {
    const out = filterTools(CATALOG, ["read_file", "list_files"]);
    expect(out.map((t) => t.function.name)).toEqual(["list_files", "read_file"]);
  });

  it("throws if meta names unknown tool", () => {
    expect(() => filterTools(CATALOG, ["nope"])).toThrow(/unknown tool/i);
  });

  it("empty allowlist yields empty array", () => {
    expect(filterTools(CATALOG, [])).toEqual([]);
  });
});
