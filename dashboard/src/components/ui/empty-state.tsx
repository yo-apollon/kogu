import { Inbox, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Kbd } from "./kbd";

export interface EmptyStateProps {
  icon?: LucideIcon;
  title?: string;
  description?: string;
  /** Comando do bot equivalente, ex.: "$summon". */
  command?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon = Inbox, title, description, command, action, className }: EmptyStateProps) {
  const t = useTranslations("empty");
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 rounded-lg border border-dashed border-border-strong px-4 py-10 text-center",
        className,
      )}
    >
      <Icon className="size-5 text-subtle" aria-hidden />
      <p className="text-base font-medium">{title ?? t("defaultTitle")}</p>
      {description ? <p className="max-w-sm text-sm text-muted">{description}</p> : null}
      {command ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          {t("useCommand")} <Kbd>{command}</Kbd>
        </p>
      ) : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
