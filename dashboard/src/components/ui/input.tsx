import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Input({ className, type = "text", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type={type}
      className={cn(
        "h-9 w-full min-w-0 rounded-md border border-border-strong bg-surface px-3 text-base text-fg",
        "placeholder:text-subtle disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-error",
        className,
      )}
      {...props}
    />
  );
}
