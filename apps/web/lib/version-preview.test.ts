import { describe, expect, it } from "vitest";
import {
  canOpenPreview,
  previewAvailabilityLabel,
} from "./version-preview";

const ver = (previewRevision: string | null) => ({ previewRevision });

describe("canOpenPreview", () => {
  it("true only when ready and revision matches", () => {
    expect(
      canOpenPreview(ver("r1"), { status: "ready", revision: "r1" }),
    ).toBe(true);
  });

  it("false when status not ready", () => {
    expect(
      canOpenPreview(ver("r1"), { status: "building", revision: "r1" }),
    ).toBe(false);
  });

  it("false when revision mismatches", () => {
    expect(
      canOpenPreview(ver("old"), { status: "ready", revision: "new" }),
    ).toBe(false);
  });

  it("false when previewRevision is null", () => {
    expect(
      canOpenPreview(ver(null), { status: "ready", revision: "r1" }),
    ).toBe(false);
  });
});

describe("previewAvailabilityLabel", () => {
  it("labels openable / covered / missing", () => {
    expect(
      previewAvailabilityLabel(ver("r1"), {
        status: "ready",
        revision: "r1",
      }),
    ).toBe("可预览");
    expect(
      previewAvailabilityLabel(ver("old"), {
        status: "ready",
        revision: "new",
      }),
    ).toBe("产物已覆盖");
    expect(
      previewAvailabilityLabel(ver(null), {
        status: "ready",
        revision: "r1",
      }),
    ).toBe("无预览");
  });
});
