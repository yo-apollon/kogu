import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";

/**
 * Shell das paginas autenticadas. Integracao pendente (fases F5/F6): buscar sessao, servidores e
 * saldo no servidor (src/server) e passa-los como `guilds`, `user`, `stats` e `signOutAction`.
 * O AppShell em si e puro e ja funciona so com o que recebe por props.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell guilds={[]}>{children}</AppShell>;
}
