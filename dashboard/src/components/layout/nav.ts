import {
  Ban,
  Coins,
  Gem,
  Heart,
  History,
  LayoutDashboard,
  Library,
  ScrollText,
  Settings,
  Trophy,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  /** Chave i18n relativa a `nav.player` ou `nav.admin`. */
  key: string;
  icon: LucideIcon;
  /** Modelo de rota; `[guildId]` e substituido pelo servidor atual. */
  href: string;
  /** Casa so a rota exata (visao geral). */
  exact?: boolean;
}

export const NAV_PLAYER: readonly NavItem[] = [
  { key: "overview", icon: LayoutDashboard, href: "/g/[guildId]", exact: true },
  { key: "pantheon", icon: Gem, href: "/g/[guildId]/pantheon" },
  { key: "wishlist", icon: Heart, href: "/g/[guildId]/wishlist" },
  { key: "economy", icon: Coins, href: "/g/[guildId]/economy" },
  { key: "history", icon: History, href: "/g/[guildId]/history" },
  { key: "catalog", icon: Library, href: "/catalog" },
  { key: "rankings", icon: Trophy, href: "/g/[guildId]/rankings" },
  { key: "profile", icon: User, href: "/me" },
];

export const NAV_ADMIN: readonly NavItem[] = [
  { key: "overview", icon: LayoutDashboard, href: "/g/[guildId]/admin", exact: true },
  { key: "settings", icon: Settings, href: "/g/[guildId]/admin/settings" },
  { key: "disabledSeries", icon: Ban, href: "/g/[guildId]/admin/disabled-series" },
  { key: "members", icon: Users, href: "/g/[guildId]/admin/members" },
  { key: "audit", icon: ScrollText, href: "/g/[guildId]/admin/audit" },
];

export function needsGuild(item: NavItem): boolean {
  return item.href.includes("[guildId]");
}

/** Resolve o modelo de rota; devolve null se precisa de servidor e nao ha um selecionado. */
export function resolveHref(item: NavItem, guildId: string | undefined): string | null {
  if (!needsGuild(item)) return item.href;
  return guildId ? item.href.replace("[guildId]", encodeURIComponent(guildId)) : null;
}

export function isActive(item: NavItem, href: string, pathname: string): boolean {
  if (item.exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Extrai o id do servidor de /g/[guildId]/... */
export function guildIdFromPath(pathname: string): string | undefined {
  const m = /^\/g\/([^/]+)/.exec(pathname);
  return m?.[1] ? decodeURIComponent(m[1]) : undefined;
}
