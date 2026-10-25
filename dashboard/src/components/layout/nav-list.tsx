"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { isActive, NAV_ADMIN, NAV_PLAYER, resolveHref, type NavItem } from "./nav";

function Group({
  title,
  items,
  scope,
  guildId,
  pathname,
  collapsible,
  onNavigate,
}: {
  title: string;
  items: readonly NavItem[];
  scope: "player" | "admin";
  guildId: string | undefined;
  pathname: string;
  /** Em 768-1024 px so os icones aparecem; o texto continua para leitores de tela. */
  collapsible: boolean;
  onNavigate?: () => void;
}) {
  const t = useTranslations(`nav.${scope}`);
  const tn = useTranslations("nav");
  return (
    <div className="grid gap-0.5">
      <h2 className={cn("px-2 pb-1 text-xs font-medium text-subtle", collapsible && "sr-only lg:not-sr-only")}>{title}</h2>
      <ul className="m-0 grid list-none gap-0.5 p-0">
        {items.map((item) => {
          const href = resolveHref(item, guildId);
          const Icon = item.icon;
          const label = t(item.key);
          const base = cn(
            "flex h-8 items-center gap-2.5 rounded-md px-2 text-base",
            collapsible && "md:max-lg:justify-center md:max-lg:px-0",
          );
          const text = <span className={cn("truncate", collapsible && "md:max-lg:sr-only")}>{label}</span>;
          if (!href) {
            return (
              <li key={item.key}>
                <span aria-disabled="true" title={tn("needGuild")} className={cn(base, "cursor-not-allowed text-subtle opacity-60")}>
                  <Icon className="size-4 shrink-0" aria-hidden />
                  {text}
                </span>
              </li>
            );
          }
          const active = isActive(item, href, pathname);
          return (
            <li key={item.key}>
              <Link
                href={href}
                title={label}
                aria-current={active ? "page" : undefined}
                onClick={onNavigate}
                className={cn(base, active ? "bg-surface-2 font-medium text-fg" : "text-muted hover:bg-surface-2 hover:text-fg")}
              >
                <Icon className={cn("size-4 shrink-0", active && "text-accent")} aria-hidden />
                {text}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export interface NavListProps {
  pathname: string;
  guildId: string | undefined;
  showAdmin: boolean;
  collapsible?: boolean;
  onNavigate?: () => void;
}

export function NavList({ pathname, guildId, showAdmin, collapsible = false, onNavigate }: NavListProps) {
  const t = useTranslations("nav");
  return (
    <nav aria-label={t("groupPlayer")} className="grid gap-5">
      <Group title={t("groupPlayer")} items={NAV_PLAYER} scope="player" guildId={guildId} pathname={pathname} collapsible={collapsible} onNavigate={onNavigate} />
      {showAdmin ? (
        <Group title={t("groupAdmin")} items={NAV_ADMIN} scope="admin" guildId={guildId} pathname={pathname} collapsible={collapsible} onNavigate={onNavigate} />
      ) : null}
    </nav>
  );
}
