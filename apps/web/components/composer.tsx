"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function Composer({
  value,
  onChange,
  onSubmit,
  placeholder,
  submitLabel = "发送",
  submittingLabel = "提交中…",
  submitting = false,
  disabled = false,
  toolbar,
  chips,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  submitLabel?: string;
  submittingLabel?: string;
  submitting?: boolean;
  disabled?: boolean;
  toolbar?: ReactNode;
  chips?: ReactNode;
}) {
  const isDisabled = disabled || submitting;

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-3">
      {chips ? <div className="min-h-0">{chips}</div> : null}
      <Textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        disabled={isDisabled}
        className="min-h-24 border-0 shadow-none outline-none focus-visible:border-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-h-9 items-center gap-2">{toolbar}</div>
        <Button
          type="button"
          className="sm:min-w-28"
          disabled={isDisabled || value.trim().length === 0}
          onClick={onSubmit}
        >
          {submitting ? submittingLabel : submitLabel}
        </Button>
      </div>
    </div>
  );
}
