"use client";

import type { ReactNode } from "react";
import { ClipboardList, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ComposerModeChips({
  planEnabled,
  teamEnabled,
  onFlagsChange,
  disabled = false,
}: {
  planEnabled: boolean;
  teamEnabled: boolean;
  onFlagsChange: (next: {
    planEnabled: boolean;
    teamEnabled: boolean;
  }) => void;
  disabled?: boolean;
}) {
  if (!planEnabled && !teamEnabled) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {planEnabled ? (
        <ModeChip
          label="Plan"
          icon={<ClipboardList className="size-3.5" aria-hidden />}
          className="border-warning/25 bg-warning/10 text-warning"
          disabled={disabled}
          onRemove={() => {
            onFlagsChange({ planEnabled: false, teamEnabled });
          }}
        />
      ) : null}
      {teamEnabled ? (
        <ModeChip
          label="Team"
          icon={<Users className="size-3.5" aria-hidden />}
          className="border-success/25 bg-success/10 text-success"
          disabled={disabled}
          onRemove={() => {
            onFlagsChange({ planEnabled, teamEnabled: false });
          }}
        />
      ) : null}
    </div>
  );
}

function ModeChip({
  label,
  icon,
  className,
  disabled,
  onRemove,
}: {
  label: string;
  icon: ReactNode;
  className?: string;
  disabled?: boolean;
  onRemove: () => void;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-medium",
        className,
      )}
    >
      {icon}
      <span>{label}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-5 shrink-0 text-current hover:bg-transparent hover:opacity-70"
        disabled={disabled}
        aria-label={`关闭 ${label}`}
        onClick={onRemove}
      >
        <X className="size-3" aria-hidden />
      </Button>
    </span>
  );
}
