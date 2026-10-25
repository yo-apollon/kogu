"use client";

import { Menu } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { GuildSwitcher } from "./guild-switcher";
import { LocaleSwitcher } from "./locale-switcher";
import { guildIdFromPath, NAV_ADMIN, resolveHref } from "./nav";
import { NavList } from "./nav-list";
import { StatChips } from "./stat-chips";
import { ThemeToggle } from "./theme-toggle";
import type { ShellGuild, ShellStats, ShellUser } from "./types";
import { UserMenu } from "./user-menu";

export interface AppShellProps {
  guilds: readonly ShellGuild[];
  /** Servidor atual; se omitido, vem de /g/[guildId] na URL. */
  guildId?: string;
  user?: ShellUser | null;
  stats?: ShellStats | null;
  signOutAction?: () => void | Promise<void>;
  /** Forca a pathname (testes e kitchen-sink). */
  pathname?: string;
  children: ReactNode;
}

function Brand() {
  const t = useTranslations("common");
  return (
    <Link href="/" className="flex h-9 items-center gap-2 px-2 font-semibold tracking-tight">
      <span aria-hidden className="size-5 rounded-md bg-accent" />
      <span className="md:max-lg:sr-only">{t("appName")}</span>
    </Link>
  );
}

export function AppShell({ guilds, guildId: guildIdProp, user, stats, signOutAction, pathname: pathnameProp, children }: AppShellProps) {
  const t = useTranslations("common");
  const livePathname = usePathname();
  const pathname = pathnameProp ?? livePathname ?? "/";
  const guildId = guildIdProp ?? guildIdFromPath(pathname);
  const canManage = guilds.find((g) => g.id === guildId)?.canManage ?? false;
  const adminHref = canManage ? resolveHref(NAV_ADMIN[0]!, guildId) : null;
  const [open, setOpen] = useState(false);

  return (
    <TooltipProvider>
      <div className="min-h-dvh md:grid md:grid-cols-[3.5rem_minmax(0,1fr)] lg:grid-cols-[15rem_minmax(0,1fr)]">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
        >
          {t("skipToContent")}
        </a>

        <aside className="sticky top-0 hidden h-dvh flex-col gap-4 overflow-y-auto border-r border-border bg-surface px-2 py-3 md:flex">
          <Brand />
          <NavList pathname={pathname} guildId={guildId} showAdmin={canManage} collapsible />
        </aside>

        <div className="min-w-0">
          <header className="sticky top-0 z-30 flex flex-wrap items-center gap-x-2 gap-y-2 border-b border-border bg-bg/90 px-4 py-2 backdrop-blur md:flex-nowrap md:px-6">
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden" aria-label={t("openMenu")}>
                  <Menu aria-hidden />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="gap-4 px-2 py-3">
                <SheetTitle className="sr-only">{t("navigation")}</SheetTitle>
                <SheetDescription className="sr-only">{t("navigation")}</SheetDescription>
                <Brand />
                <NavList pathname={pathname} guildId={guildId} showAdmin={canManage} onNavigate={() => setOpen(false)} />
              </SheetContent>
            </Sheet>

            <GuildSwitcher guilds={guilds} currentId={guildId} />
            {stats ? (
              <div className="order-last w-full overflow-x-auto sm:order-none sm:ml-1 sm:w-auto">
                <StatChips stats={stats} />
              </div>
            ) : null}
            <div className="ml-auto flex items-center gap-0.5">
              <ThemeToggle />
              <LocaleSwitcher />
              {user ? <UserMenu user={user} adminHref={adminHref} signOutAction={signOutAction} /> : null}
            </div>
          </header>

          <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl px-4 py-5 outline-none md:px-6 md:py-6">
            {children}
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
