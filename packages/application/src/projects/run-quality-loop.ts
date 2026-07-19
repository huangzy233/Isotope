export const MAX_REPAIR_ROUNDS = 2;

export type QualityLoopResult = {
  passed: boolean;
  writtenPaths: string[];
  qaReport: string | null;
  repairRoundsUsed: number;
  /** 是否应 enqueue preview */
  shouldEnqueuePreview: boolean;
};

export async function runQualityLoop(input: {
  projectId: string;
  ownerUserId: string;
  /** 已完成的首次 Alex 结果 */
  initial: { writtenPaths: string[]; assistantText: string };
  maxRepairRounds?: number;
  runAlexRepair: (extraUserContent: string) => Promise<{
    writtenPaths: string[];
    assistantText: string;
  }>;
  runQa: (changedPaths: string[]) => Promise<{
    assistantText: string;
    checkRan: boolean;
    checkOk: boolean;
  }>;
  onQaMessage?: (text: string) => void;
}): Promise<QualityLoopResult> {
  const maxRepairRounds = input.maxRepairRounds ?? MAX_REPAIR_ROUNDS;
  let paths = unique(input.initial.writtenPaths);

  if (paths.length === 0) {
    return {
      passed: true,
      writtenPaths: [],
      qaReport: null,
      repairRoundsUsed: 0,
      shouldEnqueuePreview: false,
    };
  }

  let repair = 0;
  for (;;) {
    const qa = await input.runQa(paths);
    input.onQaMessage?.(qa.assistantText);

    const passed = qa.checkRan && qa.checkOk;
    if (passed) {
      return {
        passed: true,
        writtenPaths: paths,
        qaReport: qa.assistantText,
        repairRoundsUsed: repair,
        shouldEnqueuePreview: true,
      };
    }

    if (repair >= maxRepairRounds) {
      return {
        passed: false,
        writtenPaths: paths,
        qaReport: qa.assistantText,
        repairRoundsUsed: repair,
        shouldEnqueuePreview: false,
      };
    }

    const alex = await input.runAlexRepair(qa.assistantText);
    paths = unique([...paths, ...alex.writtenPaths]);
    repair++;
  }
}

function unique(paths: string[]): string[] {
  return [...new Set(paths)];
}
