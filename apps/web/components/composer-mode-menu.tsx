"use client";

import { ClipboardList, Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

function statusText(planEnabled: boolean, teamEnabled: boolean): string {
  if (planEnabled && teamEnabled) return "当前：Plan + Team";
  if (planEnabled) return "当前：Plan（Pat 澄清需求）";
  if (teamEnabled) return "当前：Team（Mike 分配任务）";
  return "当前：Engineer（Alex 直改）";
}

export function ComposerModeMenu({
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
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-9 shrink-0"
          disabled={disabled}
          aria-label="模式与工具"
          title="模式与工具"
        >
          <Plus className="size-4" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-64 p-1">
        <div
          className={cn(
            "flex items-center gap-3 rounded-md px-3 py-2.5",
            "hover:bg-accent/60",
          )}
        >
          <ClipboardList
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground"
          />
          <label
            htmlFor="composer-plan-mode"
            className="min-w-0 flex-1 cursor-pointer text-sm text-foreground"
          >
            Plan
          </label>
          <Switch
            id="composer-plan-mode"
            checked={planEnabled}
            disabled={disabled}
            onCheckedChange={(checked) => {
              onFlagsChange({ planEnabled: checked, teamEnabled });
            }}
            aria-label="Plan 模式"
          />
        </div>
        <div
          className={cn(
            "flex items-center gap-3 rounded-md px-3 py-2.5",
            "hover:bg-accent/60",
          )}
        >
          <Users
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground"
          />
          <label
            htmlFor="composer-team-mode"
            className="min-w-0 flex-1 cursor-pointer text-sm text-foreground"
          >
            团队
          </label>
          <Switch
            id="composer-team-mode"
            checked={teamEnabled}
            disabled={disabled}
            onCheckedChange={(checked) => {
              onFlagsChange({ planEnabled, teamEnabled: checked });
            }}
            aria-label="团队模式"
          />
        </div>
        <p className="px-3 pb-2 text-xs text-muted-foreground">
          {statusText(planEnabled, teamEnabled)}
        </p>
      </PopoverContent>
    </Popover>
  );
}
