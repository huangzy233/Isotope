"use client";

import type { JSX } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export function VersionCard(props: {
  number: number;
  summary: string;
  canOpenPreview?: boolean;
  onOpenPreview?: () => void;
  unavailableReason?: string;
}): JSX.Element {
  const { number, summary, canOpenPreview, onOpenPreview, unavailableReason } =
    props;
  const showPreview = Boolean(canOpenPreview && onOpenPreview);

  return (
    <div
      className="relative overflow-hidden rounded-lg border border-border bg-primary/5 px-4 py-3.5"
      title={showPreview ? undefined : unavailableReason}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-1 top-2 text-primary/30"
      >
        <Sparkles className="size-7" strokeWidth={1.25} />
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-2 right-8 text-primary/20"
      >
        <Sparkles className="size-4" strokeWidth={1.25} />
      </div>

      <div className="relative flex items-start gap-3">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary">
          <Sparkles className="size-3.5 text-primary-foreground" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1 pr-6">
          <p className="text-sm font-semibold text-foreground">版本 {number}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {summary}
          </p>
          {showPreview ? (
            <Button
              type="button"
              variant="link"
              className="mt-1 h-auto px-0 text-xs text-primary"
              onClick={onOpenPreview}
            >
              查看预览
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
