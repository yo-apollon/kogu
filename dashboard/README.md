# Arqon Dashboard

Dashboard web do bot Arqon (Next.js 16 App Router, React 19, TypeScript estrito, Tailwind v4). Fica em `dashboard/` do monorepo informal; o bot vive na raiz. Deploy: Vercel com Root Directory `dashboard`, Node 22.

Plano completo: `../docs/dashboard-plan.md`.

## Como rodar local

```bash
cd dashboard
cp .env.example .env.local   # preencha os valores
npm ci
npm run dev                  # http://localhost:3000
```

Scripts: `dev`, `build`, `start`, `lint`, `typecheck`, `test` (unit: componentes em jsdom, server em node), `test:int` (integracao, projeto `int`, em `test/int/`), `sync:shared`.

O build NAO exige variaveis de ambiente: `src/lib/env.ts` valida de forma preguicosa no primeiro uso.

## Variaveis de ambiente

| Nome | Uso |
| --- | --- |
| `AUTH_SECRET` | segredo do Auth.js (min. 16 caracteres) |
| `AUTH_DISCORD_ID` / `AUTH_DISCORD_SECRET` | OAuth do Discord |
| `DATABASE_URL_RO` | papel `dashboard_ro` (leituras) |
| `DATABASE_URL_RW` | papel `dashboard_rw` (escritas, so em Server Actions) |
| `OWNER_IDS` | IDs Discord dos donos, separados por virgula |
| `NEXT_PUBLIC_APP_URL` | URL publica (usada em `serverActions.allowedOrigins`) |

Segredos nunca recebem prefixo `NEXT_PUBLIC_`.

## Codigo compartilhado com o bot

`npm run sync:shared` copia `../src/infra/db/schema/*.ts` -> `src/generated/schema/`, `../src/shared/**` -> `src/generated/shared/` e `../src/config/gacha.ts` -> `src/generated/config/` (dependencia de `shared/pantheon.ts`), removendo o sufixo `.js` dos imports relativos e reapontando `../infra/db/schema/` para `../schema/`. `--check` falha (exit 1) se houver drift; roda no CI. Arquivos gerados SAO commitados e nunca editados a mao. Rode o sync sempre que o schema ou `src/shared` do bot mudarem.

## Estrutura planejada

```
dashboard/
  scripts/sync-shared.mjs
  src/
    app/                 rotas (App Router); /g/[guildId]/... jogador, /g/[guildId]/admin/... admin
    components/          UI propria estilo shadcn sobre Radix
    lib/                 env, cn, auth, guardas (requireSession, requireGuildMember, ...), db
    generated/           GERADO (schema, shared, config)
  test/                  setup, stubs, components/, server/, int/
```

## Convencoes

- Identificadores em ingles; textos de UI e docs em portugues (i18n via next-intl nas fases seguintes).
- Alias `@/*` -> `src/*`. `server-only` em todo modulo que toca banco/segredos (stub nos testes).
- Autorizacao sempre no servidor (paginas, layouts e actions); userId vem da sessao.
- Leituras via `DATABASE_URL_RO`; escritas so em Server Actions via `DATABASE_URL_RW`.
- Tema por `data-theme` no `<html>` (script inline no `<head>`, sem flash); tokens em `globals.css`.
- CSP em `next.config.ts` usa `'unsafe-inline'` em scripts (tema + runtime do Next); trocar por nonce quando houver middleware.

## Versoes e incompatibilidades

- Next 16.4.x + React 19.3 + `next-auth@5.0.0-beta.32`: o peer range do beta declara `next ^16`, instala sem conflito.
- TypeScript fixado em 5.x (o `latest` do npm e 7.x, ainda nao validado com Next/ESLint); ESLint em 9.x (eslint-config-next aceita >=9; v10 nao adotado). 
- `@tanstack/react-table` fixado em 8.x (o `latest` e 9.x, API diferente).
- `drizzle-orm` 0.33.x igual ao bot.
- Vitest 5 (Vite 7/8) com `projects` (components/server/int); config em ESM (`"type": "module"`).