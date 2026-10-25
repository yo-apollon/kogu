import { TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Button } from "./button";

export interface ErrorStateProps {
  title?: string;
  description?: string;
  /** Identificador do erro (digest do Next) para suporte. */
  digest?: string;
  onRetry?: () => void;
  action?: ReactNode;
  className?: string;
}

export function ErrorState({ title, description, digest, onRetry, action, className }: ErrorStateProps) {
  const t = useTranslations("error");
  return (
    <div
      role="alert"
      className={cn("flex flex-col items-center gap-2 rounded-lg border border-border px-4 py-10 text-center", className)}
    >
      <TriangleAlert className="size-5 text-error" aria-hidden />
      <p className="text-base font-medium">{title ?? t("title")}</p>
      <p className="max-w-sm text-sm text-muted">{description ?? t("description")}</p>
      {digest ? <p className="font-mono text-xs text-subtle">{t("digest", { id: digest })}</p> : null}
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-1">
          {t("retry")}
        </Button>
      ) : null}
      {action}
    </div>
  );
}
