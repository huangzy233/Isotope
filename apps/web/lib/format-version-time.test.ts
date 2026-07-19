import { describe, expect, it } from "vitest";
import {
  formatAbsoluteTime,
  formatRelativeTime,
} from "./format-version-time";

describe("formatRelativeTime", () => {
  const now = Date.parse("2026-07-19T12:00:00.000Z");

  it("uses minutes / hours / days buckets", () => {
    expect(
      formatRelativeTime("2026-07-19T11:59:00.000Z", now),
    ).toBe("1 分钟前");
    expect(
      formatRelativeTime("2026-07-19T10:00:00.000Z", now),
    ).toBe("2 小时前");
    expect(
      formatRelativeTime("2026-07-17T12:00:00.000Z", now),
    ).toBe("2 天前");
  });
});

describe("formatAbsoluteTime", () => {
  it("returns a non-empty zh-CN style string", () => {
    const s = formatAbsoluteTime("2026-07-19T12:00:00.000Z");
    expect(s.length).toBeGreaterThan(8);
    expect(s).toMatch(/2026/);
  });
});
