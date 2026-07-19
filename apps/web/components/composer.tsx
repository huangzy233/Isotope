"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { ArrowRight, Loader2, Send } from "lucide-react";
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
  submitIcon = "send",
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
  /** Visual for the primary action; label stays as accessible name. */
  submitIcon?: "send" | "start";
}) {
  const isDisabled = disabled || submitting;
  const canSubmit = !isDisabled && value.trim().length > 0;
  const SubmitIcon = submitIcon === "start" ? ArrowRight : Send;

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    // Avoid submitting while IME (e.g. Chinese) is composing.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    if (canSubmit) onSubmit();
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-3">
      {chips ? <div className="min-h-0">{chips}</div> : null}
      <Textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={isDisabled}
        className="min-h-32 border-0 shadow-none outline-none focus-visible:border-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-h-9 items-center gap-2">{toolbar}</div>
        <Button
          type="button"
          size="icon"
          className="h-10 w-10 shrink-0 self-end sm:self-auto"
          disabled={!canSubmit}
          onClick={onSubmit}
          aria-label={submitting ? submittingLabel : submitLabel}
          title={submitting ? submittingLabel : submitLabel}
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <SubmitIcon className="h-4 w-4" aria-hidden />
          )}
        </Button>
      </div>
    </div>
  );
}
