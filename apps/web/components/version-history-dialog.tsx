"use client";

import { useEffect, useState, type JSX } from "react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatAbsoluteTime, formatRelativeTime } from "@/lib/format-version-time";
import {
  canOpenPreview,
  previewAvailabilityLabel,
} from "@/lib/version-preview";

type VersionRow = {
  id: string;
  number: number;
  summary: string;
  previewRevision: string | null;
  createdAt: string;
};

export function VersionHistoryDialog(props: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preview: { status: string; revision: string | null } | null;
  onOpenPreview: () => void;
}): JSX.Element {
  const { projectId, open, onOpenChange, preview, onOpenPreview } = props;
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/versions`);
        const data = (await res.json().catch(() => null)) as {
          versions?: VersionRow[];
          error?: string;
        } | null;
        if (cancelled) return;
        if (!res.ok) {
          setVersions([]);
          setError(data?.error ?? "加载版本失败");
          return;
        }
        setVersions(data?.versions ?? []);
      } catch {
        if (!cancelled) {
          setVersions([]);
          setError("加载版本失败");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>版本记录</DialogTitle>
          <DialogDescription>
            成功构建后的变更摘要；仅当前预览产物可打开。
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            加载中…
          </p>
        ) : error ? (
          <p className="py-8 text-center text-sm text-destructive">{error}</p>
        ) : versions.length === 0 ? (
          <EmptyState
            title="暂无版本记录"
            description="成功构建后会在这里显示版本。"
          />
        ) : (
          <ul className="max-h-[min(60vh,28rem)] overflow-y-auto rounded-md border border-border divide-y divide-border">
            {versions.map((version) => {
              const openable = canOpenPreview(version, preview);
              const label = previewAvailabilityLabel(version, preview);
              return (
                <li
                  key={version.id}
                  className="flex items-start justify-between gap-3 px-3 py-3"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-sm font-medium text-foreground">
                      版本 {version.number}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {version.summary}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatRelativeTime(version.createdAt)} ·{" "}
                      {formatAbsoluteTime(version.createdAt)} · {label}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    disabled={!openable}
                    onClick={onOpenPreview}
                  >
                    查看预览
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
