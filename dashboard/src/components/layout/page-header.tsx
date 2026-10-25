import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface PageTab {
  href: string;
  label: string;
  active?: boolean;
}

export interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  /** Abas de navegacao entre sub-rotas (links, nao paineis). */
  tabs?: readonly PageTab[];
  tabsLabel?: string;
  className?: string;
}

export function PageHeader({ title, description, actions, tabs, tabsLabel, className }: PageHeaderProps) {
  return (
    <header className={cn("mb-6 grid gap-3", className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="grid min-w-0 gap-1">
          <h1 className="text-xl leading-7 font-semibold tracking-tight sm:text-2xl sm:leading-8">{title}</h1>
          {description ? <p className="max-w-2xl text-base text-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {tabs && tabs.length > 0 ? (
        <nav aria-label={tabsLabel ?? title} className="-mb-px overflow-x-auto border-b border-border">
          <ul className="m-0 flex list-none gap-1 p-0">
            {tabs.map((tab) => (
              <li key={tab.href}>
                <Link
                  href={tab.href}
                  aria-current={tab.active ? "page" : undefined}
                  className={cn(
                    "-mb-px inline-flex h-9 items-center border-b-2 px-3 text-base font-medium whitespace-nowrap",
                    tab.active ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg",
                  )}
                >
                  {tab.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </header>
  );
}
