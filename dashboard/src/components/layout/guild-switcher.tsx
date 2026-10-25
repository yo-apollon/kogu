"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ShellGuild } from "./types";

export function GuildSwitcher({ guilds, currentId }: { guilds: readonly ShellGuild[]; currentId?: string }) {
  const t = useTranslations("shell.guildSwitcher");
  const router = useRouter();
  const current = guilds.find((g) => g.id === currentId);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("label")}
        className="inline-flex h-9 max-w-[11rem] min-w-0 items-center gap-2 rounded-md border border-border-strong bg-surface px-2 text-base hover:bg-surface-2 sm:max-w-[14rem]"
      >
        {current ? <Avatar name={current.name} src={current.icon} size={20} rounded="md" /> : null}
        <span className="truncate">{current?.name ?? t("placeholder")}</span>
        <ChevronsUpDown className="size-4 shrink-0 text-subtle" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-64 overflow-y-auto">
        <DropdownMenuLabel>{t("label")}</DropdownMenuLabel>
        {guilds.length === 0 ? (
          <p className="px-2 py-2 text-sm text-muted">{t("noGuilds")}</p>
        ) : (
          guilds.map((g) => (
            <DropdownMenuItem key={g.id} onSelect={() => router.push(`/g/${encodeURIComponent(g.id)}`)}>
              <Avatar name={g.name} src={g.icon} size={20} rounded="md" />
              <span className="min-w-0 flex-1 truncate">{g.name}</span>
              {g.canManage ? <span className="text-xs text-subtle">{t("manage")}</span> : null}
              {g.id === currentId ? <Check aria-hidden /> : null}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
