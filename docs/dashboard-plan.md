# Plano da dashboard Arqon (Next.js na Vercel + Neon)

Plano elaborado pelo agente de planejamento (Opus). Executado por agentes Sonnet em fases com arquivos exclusivos.

## Atualização (substitui o que disser Neon abaixo)
- Banco de produção: **Supabase Postgres, região São Paulo (sa-east-1)**, no lugar do Neon (o plano grátis do Neon não comporta o bot 24h).
- A dashboard usa o driver `postgres` (postgres-js) também em produção, pelo pooler do Supabase em modo transação com `prepare: false`; o bot usa a conexão direta ou o pooler em modo sessão. Os papéis `dashboard_ro` e `dashboard_rw` são criados por SQL no Supabase. O risco de horas de compute do Neon não se aplica; a otimização do sweep ocioso é opcional.

## Decisões fechadas
- Banco de produção: ~~Neon~~ Supabase (ver acima), compartilhado entre o bot (rodando no PC do dono, 24h) e a dashboard.
- Dashboard em `dashboard/` neste repositório (GitHub `yo-apollon/arqon`); Vercel com Root Directory `dashboard`.
- Login com Discord (Auth.js v5, scopes `identify guilds`, sessão JWT sem adapter).
- Escopo v1: A) jogador e B) admin do servidor. C) staff do catálogo depois (layout e guarda já preparados).

## Arquitetura
- Next.js 16 (App Router, RSC), React 19, TypeScript estrito, Tailwind v4, componentes próprios estilo shadcn sobre Radix, Recharts só no admin, TanStack Table e Virtual.
- Dados: drizzle-orm 0.33.x (mesma versão do bot) com `@neondatabase/serverless` (neon-http). Leituras via `DATABASE_URL_RO`; escritas só nas Server Actions via `DATABASE_URL_RW`.
- Schema reaproveitado por cópia gerada (`dashboard/scripts/sync-shared.mjs` copia `src/infra/db/schema/*` e `src/shared/**` para `dashboard/src/generated/`), com checagem de drift no CI.
- Paginação por cursor (keyset). Cache: catálogo por hora; dados do jogador sem cache; agregados do admin 30 a 60 s.

## Autorização (revisão cuidadosa)
- Servidores = interseção entre `/users/@me/guilds` (cache 60 s) e `guilds` do banco. Admin = bit 0x8 ou dono; gerenciar = 0x20.
- Guardas server-side em toda página, layout e action (`requireSession`, `requireGuildMember`, `requireGuildManager`, `requireGuildAdmin`, `requireStaff`). Jogador só vê os próprios dados (userId vem da sessão). Guild fora da interseção responde 404.
- Escritas: permissões rebuscadas sem cache, zod idêntico ao do bot, rate limit em tabela Postgres, auditoria, controle de versão otimista (`config_version`).
- Papéis no Neon: `arqon_bot` (dono), `dashboard_ro`, `dashboard_rw` (apenas colunas aprovadas). A dashboard nunca escreve em pactos, saldo, relíquias, ofertas nem entidades.

## Páginas
- Jogador (`/g/[guildId]/...`): Visão geral, Panteão (filtros, busca, detalhe, arte da skin Mudae em CSS), Wishlist, Economia e Relíquias, Histórico (rolls e claims), Catálogo (busca trigram, página da entidade e da série), Rankings (Éter, pactos, patrimônio, wishes), Perfil.
- Admin (`/g/[guildId]/admin/...`): Visão geral (KPIs e gráficos de 30 dias), Configurações (rolls, timer, claim, gamemode, prefix, lang; demais campos somente leitura), Séries desativadas do servidor, Membros, Auditoria.
- Staff (fora da v1): moderação, sugestões, saúde do pipeline.

## Mudanças no bot (fase F2)
- Migration `0003_dashboard`: `guilds.name/icon/bot_present/config_version`, `users.avatar/global_name`, `guild_members.last_daily_at`, `dashboard_audit_log`, `dashboard_rate_limit`, índices de histórico.
- Módulos puros em `src/shared/` (guildSettings, relics, time, pantheon, text, search) reutilizados pelo bot e pela dashboard.
- `guildConfig`: hoje o cache pode levar até ~10 min. Passa a validar `config_version` ao vencer o cache local (30 s) e a desligar a camada KV quando o KV é MemoryStore.
- Eventos guildCreate/guildUpdate/guildDelete atualizam nome, ícone e presença. Poda de `roll_offers` e do rate limit.
- O sweep de ofertas e o refresh do pool não consultam o banco sem atividade (para o Neon poder suspender).

## Fases
F1 scaffolding e CI; F2 bot (compartilhados, migration, propagação); F3 camada de dados e auth; F4 layout e design system; F5a/b/c abas do jogador; F6a/b admin (F6b = escrita, revisão cuidadosa); F7 testes de integração e E2E; F8 documentação de deploy e script `copyToNeon`.
Paralelismo: {F1, F2} depois {F3, F4} depois {F5a, F5b, F5c, F6a, F6b} depois F7 depois F8.

## Deploy
Neon (Postgres 18 se disponível; URL direct para bot e migrations, pooled para a dashboard) → migrations → papéis → cópia dos dados do banco local → Discord OAuth redirects → Vercel (Root Directory `dashboard`, Node 22, região igual à do Neon) → bot aponta para o Neon.

## Riscos e decisões em aberto
- Plano grátis do Neon: o bot 24h mantém o compute ligado (cerca de 182 CU-h por mês contra cerca de 100 de limite). Esgotada a cota, o banco suspende e o bot cai. Opções: reduzir consultas ociosas (F2) e/ou plano pago.
- Latência do bot no Neon (20 a 150 ms por query) torna roll e claim mais lentos que no banco local.
- Região do Neon (sa-east-1 ou us-east-1), faixas das configurações ainda não editáveis, ledger de Éter, Auth.js beta ou Better Auth, edição de dados pelo jogador, conteúdo adulto no catálogo global, dados dos previews.
