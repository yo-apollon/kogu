"use client";

import { Coins, Dices } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { formatAether, formatNumber, formatRelative } from "@/lib/format";
import type { ShellStats } from "./types";

function Chip({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div
      role="group"
      aria-label={label}
      className="num inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 text-sm"
    >
      {icon}
      {children}
    </div>
  );
}

/** Chips de saldo e invocacoes do servidor atual. */
export function StatChips({ stats }: { stats: ShellStats }) {
  const t = useTranslations("shell.stats");
  const locale = useLocale();
  const rolls = stats.rollsMax !== undefined ? `${formatNumber(stats.rollsLeft, locale)}/${formatNumber(stats.rollsMax, locale)}` : formatNumber(stats.rollsLeft, locale);
  return (
    <div className="flex items-center gap-1.5">
      <Chip icon={<Coins className="size-3.5 text-subtle" aria-hidden />} label={t("aetherLabel")}>
        <span title={t("aetherLabel")}>{formatAether(stats.aether, locale, { compact: stats.aether >= 100_000 })}</span>
      </Chip>
      <Chip icon={<Dices className="size-3.5 text-subtle" aria-hidden />} label={t("rollsLabel")}>
        <span>{rolls}</span>
        {stats.rollsResetAt ? (
          <span className="hidden text-xs text-subtle md:inline">{t("resets", { when: formatRelative(stats.rollsResetAt, locale) })}</span>
        ) : null}
      </Chip>
    </div>
  );
}
