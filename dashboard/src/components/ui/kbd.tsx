import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 items-center rounded-sm border border-border-strong bg-surface-2 px-1.5 font-mono text-xs text-fg",
        className,
      )}
      {...props}
    />
  );
}
