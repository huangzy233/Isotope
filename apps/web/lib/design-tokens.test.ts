import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const globalsCss = readFileSync(
  resolve(__dirname, "../app/globals.css"),
  "utf8",
);

describe("design tokens", () => {
  it("uses blue primary #2563EB (HSL 221 83% 53%)", () => {
    expect(globalsCss).toMatch(/--primary:\s*221\s+83%\s+53%/);
  });

  it("uses matching blue ring", () => {
    expect(globalsCss).toMatch(/--ring:\s*221\s+83%\s+53%/);
  });
});
