import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

/** Grade responsiva de cartas: auto-fill com minimo de 140 px. Use <li> como filhos. */
export function CardGrid({ className, ...props }: ComponentProps<"ul">) {
  return (
    <ul
      className={cn("grid list-none gap-3 p-0 sm:gap-4", className)}
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}
      {...props}
    />
  );
}
