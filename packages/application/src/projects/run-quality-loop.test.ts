import { describe, expect, it, vi } from "vitest";
import { MAX_REPAIR_ROUNDS, runQualityLoop } from "./run-quality-loop.js";

describe("runQualityLoop", () => {
  it("exposes MAX_REPAIR_ROUNDS = 2", () => {
    expect(MAX_REPAIR_ROUNDS).toBe(2);
  });

  it("passes on first QA checkOk", async () => {
    const runAlexRepair = vi.fn(async () => {
      throw new Error("should not repair");
    });
    const runQa = vi.fn(async () => ({
      assistantText: "【质检结果】PASS\n检查：typecheck\n问题：无",
      checkRan: true,
      checkOk: true,
    }));

    const r = await runQualityLoop({
      projectId: "p",
      ownerUserId: "u",
      initial: { writtenPaths: ["src/App.tsx"], assistantText: "done" },
      runAlexRepair,
      runQa,
    });

    expect(r.passed).toBe(true);
    expect(r.shouldEnqueuePreview).toBe(true);
    expect(r.repairRoundsUsed).toBe(0);
    expect(r.qaReport).toBe("【质检结果】PASS\n检查：typecheck\n问题：无");
    expect(r.writtenPaths).toEqual(["src/App.tsx"]);
    expect(runQa).toHaveBeenCalledTimes(1);
    expect(runQa).toHaveBeenCalledWith(["src/App.tsx"]);
    expect(runAlexRepair).not.toHaveBeenCalled();
  });

  it("repairs then passes", async () => {
    const runAlexRepair = vi.fn(async () => ({
      writtenPaths: ["src/App.tsx", "src/main.tsx"],
      assistantText: "fixed",
    }));
    const runQa = vi
      .fn()
      .mockResolvedValueOnce({
        assistantText: "【质检结果】FAIL\n检查：typecheck\n问题：error",
        checkRan: true,
        checkOk: false,
      })
      .mockResolvedValueOnce({
        assistantText: "【质检结果】PASS\n检查：typecheck\n问题：无",
        checkRan: true,
        checkOk: true,
      });

    const r = await runQualityLoop({
      projectId: "p",
      ownerUserId: "u",
      initial: { writtenPaths: ["src/App.tsx"], assistantText: "done" },
      runAlexRepair,
      runQa,
    });

    expect(r.passed).toBe(true);
    expect(r.shouldEnqueuePreview).toBe(true);
    expect(r.repairRoundsUsed).toBe(1);
    expect(r.qaReport).toBe("【质检结果】PASS\n检查：typecheck\n问题：无");
    expect(r.writtenPaths).toEqual(["src/App.tsx", "src/main.tsx"]);
    expect(runQa).toHaveBeenCalledTimes(2);
    expect(runAlexRepair).toHaveBeenCalledTimes(1);
    expect(runAlexRepair).toHaveBeenCalledWith(
      "【质检结果】FAIL\n检查：typecheck\n问题：error",
    );
    expect(runQa.mock.calls[1]?.[0]).toEqual(["src/App.tsx", "src/main.tsx"]);
  });

  it("exhausts repairs without preview", async () => {
    const runAlexRepair = vi.fn(async () => ({
      writtenPaths: ["src/App.tsx"],
      assistantText: "tried",
    }));
    const runQa = vi.fn(async () => ({
      assistantText: "【质检结果】FAIL\n检查：typecheck\n问题：still broken",
      checkRan: true,
      checkOk: false,
    }));

    const r = await runQualityLoop({
      projectId: "p",
      ownerUserId: "u",
      initial: { writtenPaths: ["src/App.tsx"], assistantText: "done" },
      runAlexRepair,
      runQa,
    });

    expect(r.passed).toBe(false);
    expect(r.shouldEnqueuePreview).toBe(false);
    expect(r.repairRoundsUsed).toBe(MAX_REPAIR_ROUNDS);
    expect(r.qaReport).toBe("【质检结果】FAIL\n检查：typecheck\n问题：still broken");
    expect(runAlexRepair).toHaveBeenCalledTimes(MAX_REPAIR_ROUNDS);
    // initial QA + one after each repair
    expect(runQa).toHaveBeenCalledTimes(MAX_REPAIR_ROUNDS + 1);
  });

  it("skips when no written paths", async () => {
    const runAlexRepair = vi.fn(async () => {
      throw new Error("should not repair");
    });
    const runQa = vi.fn(async () => {
      throw new Error("should not QA");
    });

    const r = await runQualityLoop({
      projectId: "p",
      ownerUserId: "u",
      initial: { writtenPaths: [], assistantText: "nothing changed" },
      runAlexRepair,
      runQa,
    });

    expect(r.passed).toBe(true);
    expect(r.shouldEnqueuePreview).toBe(false);
    expect(r.writtenPaths).toEqual([]);
    expect(r.qaReport).toBeNull();
    expect(r.repairRoundsUsed).toBe(0);
    expect(runQa).not.toHaveBeenCalled();
    expect(runAlexRepair).not.toHaveBeenCalled();
  });

  it("treats checkRan false as fail even if checkOk true", async () => {
    const runAlexRepair = vi.fn(async () => ({
      writtenPaths: [],
      assistantText: "noop",
    }));
    const runQa = vi.fn(async () => ({
      assistantText: "【质检结果】FAIL\n检查：未执行\n问题：质检未执行 run_check",
      checkRan: false,
      checkOk: true,
    }));

    const r = await runQualityLoop({
      projectId: "p",
      ownerUserId: "u",
      initial: { writtenPaths: ["src/App.tsx"], assistantText: "done" },
      maxRepairRounds: 0,
      runAlexRepair,
      runQa,
    });

    expect(r.passed).toBe(false);
    expect(r.shouldEnqueuePreview).toBe(false);
    expect(runAlexRepair).not.toHaveBeenCalled();
  });

  it("calls onQaMessage after each QA round", async () => {
    const onQaMessage = vi.fn();
    const runQa = vi
      .fn()
      .mockResolvedValueOnce({
        assistantText: "fail-report",
        checkRan: true,
        checkOk: false,
      })
      .mockResolvedValueOnce({
        assistantText: "pass-report",
        checkRan: true,
        checkOk: true,
      });

    await runQualityLoop({
      projectId: "p",
      ownerUserId: "u",
      initial: { writtenPaths: ["a.ts"], assistantText: "done" },
      runAlexRepair: async () => ({ writtenPaths: [], assistantText: "ok" }),
      runQa,
      onQaMessage,
    });

    expect(onQaMessage).toHaveBeenCalledTimes(2);
    expect(onQaMessage).toHaveBeenNthCalledWith(1, "fail-report");
    expect(onQaMessage).toHaveBeenNthCalledWith(2, "pass-report");
  });

  it("dedupes written paths", async () => {
    const runQa = vi.fn(async (paths: string[]) => {
      expect(paths).toEqual(["src/App.tsx"]);
      return {
        assistantText: "【质检结果】PASS",
        checkRan: true,
        checkOk: true,
      };
    });

    const r = await runQualityLoop({
      projectId: "p",
      ownerUserId: "u",
      initial: {
        writtenPaths: ["src/App.tsx", "src/App.tsx"],
        assistantText: "done",
      },
      runAlexRepair: async () => {
        throw new Error("should not repair");
      },
      runQa,
    });

    expect(r.writtenPaths).toEqual(["src/App.tsx"]);
  });
});
