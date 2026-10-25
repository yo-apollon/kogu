import Image from "next/image";
import { cn } from "@/lib/cn";

export function initials(name: string, max = 2): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const letters =
    words.length === 1 ? Array.from(words[0] ?? "").slice(0, max) : words.slice(0, max).map((w) => Array.from(w)[0] ?? "");
  return letters.join("").toUpperCase();
}

export interface AvatarProps {
  name: string;
  src?: string | null;
  size?: number;
  rounded?: "full" | "md";
  className?: string;
}

/** Avatar decorativo: o nome acessivel vem do elemento pai (botao/linha). */
export function Avatar({ name, src, size = 24, rounded = "full", className }: AvatarProps) {
  const shape = rounded === "full" ? "rounded-full" : "rounded-md";
  return src ? (
    <Image
      src={src}
      alt=""
      width={size}
      height={size}
      unoptimized
      loading="lazy"
      className={cn("shrink-0 bg-surface-2 object-cover", shape, className)}
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center bg-surface-2 text-[10px] font-semibold text-muted",
        shape,
        className,
      )}
      style={{ width: size, height: size }}
    >
      {initials(name)}
    </span>
  );
}
