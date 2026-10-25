"use client";

import { LogOut, Shield, User } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ShellUser } from "./types";

export interface UserMenuProps {
  user: ShellUser;
  /** href da administracao do servidor atual; so passe quando o usuario pode gerenciar. */
  adminHref?: string | null;
  /** Server Action de logout (form action). */
  signOutAction?: () => void | Promise<void>;
}

export function UserMenu({ user, adminHref, signOutAction }: UserMenuProps) {
  const t = useTranslations("shell.user");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${t("menu")}: ${user.name}`}
        className="inline-flex size-9 items-center justify-center rounded-full hover:bg-surface-2"
      >
        <Avatar name={user.name} src={user.avatar} size={28} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="grid gap-0.5">
          <span className="truncate text-base font-medium text-fg">{user.name}</span>
          {user.handle ? <span className="truncate font-normal">{user.handle}</span> : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/me">
            <User aria-hidden />
            {t("profile")}
          </Link>
        </DropdownMenuItem>
        {adminHref ? (
          <DropdownMenuItem asChild>
            <Link href={adminHref}>
              <Shield aria-hidden />
              {t("admin")}
            </Link>
          </DropdownMenuItem>
        ) : null}
        {signOutAction ? (
          <>
            <DropdownMenuSeparator />
            <form action={signOutAction}>
              <DropdownMenuItem asChild>
                <button type="submit" className="w-full">
                  <LogOut aria-hidden />
                  {t("signOut")}
                </button>
              </DropdownMenuItem>
            </form>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
