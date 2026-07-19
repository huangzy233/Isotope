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
      className="relative overflow-hidden rounded-2xl border border-[#d8defa] bg-[#f3f5ff] px-4 py-3.5"
      title={showPreview ? undefined : unavailableReason}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-1 top-2 text-[#c9d0f5]/70"
      >
        <Sparkles className="size-7" strokeWidth={1.25} />
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-2 right-8 text-[#c9d0f5]/45"
      >
        <Sparkles className="size-4" strokeWidth={1.25} />
      </div>

      <div className="relative flex items-start gap-3">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-[#5c67f2]">
          <Sparkles className="size-3.5 text-white" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1 pr-6">
          <p className="text-sm font-semibold text-[#1a1c3d]">版本 {number}</p>
          <p className="mt-1 text-xs leading-relaxed text-[#4a4e69]">
            {summary}
          </p>
          {showPreview ? (
            <Button
              type="button"
              variant="link"
              className="mt-1 h-auto px-0 text-xs"
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
