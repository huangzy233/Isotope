import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(__dirname, "../components/version-card.tsx"),
  "utf8",
);

describe("VersionCard tokens", () => {
  it("does not hardcode hex colors", () => {
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});
