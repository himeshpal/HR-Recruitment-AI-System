"use client";

import { Eye, EyeOff } from "lucide-react";

import { Switch } from "@/components/ui/switch";
import { setBlind, useBlind } from "@/lib/blind";

export function BlindToggle() {
  const blind = useBlind();
  return (
    <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-1.5 text-sm">
      {blind ? <EyeOff className="size-4 text-primary" /> : <Eye className="size-4 text-muted-foreground" />}
      <span className="font-medium">Blind mode</span>
      <Switch checked={blind} onCheckedChange={setBlind} aria-label="Blind mode: hide candidate names and contact details" />
    </label>
  );
}
