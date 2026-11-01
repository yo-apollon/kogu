# Kogu: o que falta fazer

Estado em 25/10/2026. O bot (v2) roda localmente com Postgres embutido (`npm run dev:local`). A dashboard tem esqueleto, autenticação, camada de dados e design system, mas ainda nenhuma aba de conteúdo. O plano detalhado da dashboard está em `docs/dashboard-plan.md`.

## 1. Bot

### Catálogo (afeta o jogo agora)
- O catálogo tem 310 entidades ativas, quase todas de anime. `$ar` devolve sempre a Excalibur (1 arma), `$wg` e `$hg` têm 1 carta cada, e `$wc`, `$hc`, `$mc`, `$sc` (cinema) não têm nenhuma.
- Rodar o sync do AniList (sem chave): `npm run catalog:bootstrap` ou `npm run sync:once -- --source=anilist --limit=200`, depois `npm run sync:once -- --job=rerank`.
- Jogos: exige `TWITCH_CLIENT_ID` e `TWITCH_CLIENT_SECRET` no `.env`. Cinema: exige `TMDB_API_KEY`. Só personagens de animação do TMDB entram automaticamente.
- Armas: não existe fonte de API. Criar uma lista curada de armas lendárias (tipo WEAPON) com arte própria ou fallback de iniciais.
- Gêneros importados do SQLite ainda não foram confirmados pela fonte (podem ter sido sorteados no bot antigo); o sync corrige.
- Revisar a fila de moderação (`/catalog review`) depois do sync.

### Comandos e jogo
- Registrar os slash commands no Discord (29 prontos): `npm run deploy:commands` (usar `DEV_GUILD_ID` no `.env` para registro imediato em um servidor).
- Footer da carta mostra "X / 40" fixo; deve usar `guilds.pact_limit`. Para isso, adicionar `pactsPerWindow` e `aetherSnipeProtection*` ao `GuildConfig` em `src/core/contracts.ts`.
- Skin cosmética escolhida pelo dono do pacto: não existe coluna no schema.
- `src/modules/collection/commands.ts` ainda usa rótulos locais nas opções de slash; trocar pelas chaves `collection.slash.*` e `collection.sort.*` que já existem nos locales.
- Decisões de comportamento a confirmar: `$daily` restaura rolls e cargas de pacto da janela e dá +5 empilhados (cooldown de 20 h agora no banco); `$give` perde apelidos, nota, imagem, cor e posição de líder; `$rolls` mostra só rolls restantes; `y` e `y-` nas flags do `$pt` casam todos ou nenhum porque `claimPact` grava `awakening_keys = 1`.
- Otimização opcional: o sweep de ofertas a cada 30 s consulta o banco mesmo sem atividade.

### Novidades pedidas
- F13: cards animados para HOLO e ASTRAL (WebP animado ou GIF, abaixo de uns 8 MB, render só para variantes raras com cache) e imagem ou GIF próprio do dono (`custom_image_url` via `safeFetchImage`, com limite de tamanho e moderação). Script de teste em `.cache/test-cards/`.

### Operação
- Rodar 24h: criar uma tarefa agendada do Windows que inicie o bot ao ligar o PC e reinicie se cair; desativar suspensão do PC na tomada. Hoje o bot morre quando a sessão do terminal fecha.
- O Postgres embutido do `dev:local` é só para desenvolvimento; já caiu uma vez.
- Docker, `docker-compose` e `Dockerfile` nunca foram validados (sem Docker na máquina). O `RedisKV` real nunca rodou contra um Redis real (testes de integração do Redis ficam pulados sem `TEST_REDIS_URL`).
- Produção: criar projeto Supabase (São Paulo), rodar `npm run db:migrate` com a URL direta, rodar `docs/supabase-roles.sql` (papéis `dashboard_ro`, `dashboard_rw`), copiar os dados do banco local, apontar o `DATABASE_URL` do bot para o Supabase. Falta escrever o script de cópia de dados (`src/scripts/copyToSupabase.ts`, plano F8). Esperar latência maior por consulta no bot.
- Rotacionar o `DISCORD_TOKEN` se esta pasta já foi compartilhada.

### Limpeza (Onda E)
- Remover código legado do bot antigo: `src/handlers`, `src/commands`, `src/database`, `src/redis/index.ts`, `src/engine/summonEngine.ts`, `src/scripts/{seed,massSeed,migrateColumns,testEngine}.ts` e o `cardRenderer.ts` antigo (conferir se `renderCharacterCard` em `src/canvas/engine/pool.ts` ainda o usa), mais `test-card.png`. Mover `better-sqlite3` para `devDependencies` (só `migrateFromSqlite` e `dev:local` usam). Atualizar o README. Revisão final com modelo forte das partes críticas (claim concorrente, pipeline e merge, migração).

## 2. Dashboard (`dashboard/`)

Feito: F1 esqueleto, F3 login Discord e autorização e camada de dados (130 testes), F4 design system e layout (64 testes).

Falta, nesta ordem:
- **F5a** abas do jogador: Visão geral, Economia e Relíquias, Histórico (`roll_log`, `roll_offers`).
- **F5b** Panteão (filtros, busca, detalhe, arte da skin Mudae em CSS) e Wishlist.
- **F5c** Catálogo (busca trigram, página da entidade e da série), Rankings e Perfil.
- **F6a** admin: visão geral com gráficos de 30 dias, membros, auditoria.
- **F6b** admin: configurações (rolls, timer, claim, gamemode, prefix, lang) e séries desativadas do servidor. É escrita: revisão cuidadosa, validação idêntica à do bot, versão otimista, auditoria, `requireGuildAdmin` para séries server-wide.
- **F7** testes de integração e E2E (queries e autorização com Postgres embutido, componentes, Playwright opcional).
- **F8** documentação de deploy (`dashboard/docs/DEPLOY.md`) e script de cópia para o Supabase.
- Ligar o `AppShell` ao mundo real: sessão, lista de servidores, chips de saldo/rolls e ação de logout (`src/app/(app)/layout.tsx` hoje renderiza com `guilds=[]`).
- Depois de qualquer mudança em `src/shared` ou no schema do bot: `cd dashboard && npm run sync:shared` (o CI falha se as cópias divergirem).
- Painel de staff (C), depois da v1: fila de moderação, sugestões, saúde do pipeline (`sync_runs`).
- Segurança e qualidade: `npm audit` da dashboard reportou 2 vulnerabilidades altas (não investigadas); trocar `'unsafe-inline'` do CSP por nonce; o cache de permissões do Discord dura 60 s (escritas devem usar as variantes `...Fresh`); refresh de token do Discord só persiste via route handler ou server action.

### Deploy da dashboard
- Discord Developer Portal: cadastrar redirects `http://localhost:3000/api/auth/callback/discord` e `https://<domínio>/api/auth/callback/discord`; guardar Client ID e Secret.
- Vercel: importar `yo-apollon/arqon`, Root Directory `dashboard`, Node 22, região perto do Supabase. Variáveis: `AUTH_SECRET`, `AUTH_DISCORD_ID`, `AUTH_DISCORD_SECRET`, `AUTH_TRUST_HOST`, `DATABASE_URL_RO`, `DATABASE_URL_RW`, `OWNER_IDS`, `NEXT_PUBLIC_APP_URL`. URL do banco da dashboard: pooler do Supabase em modo transação (`prepare: false` já configurado).

## 3. Decisões em aberto
- Faixas editáveis para as configurações do servidor que ainda não têm comando (intervalo de rolls, deslocamento do reset, pactos por janela, proteção de snipe, limite de pactos, release boost, conteúdo adulto).
- Histórico de Éter (`aether_ledger`): não existe, a dashboard mostra só o estado atual.
- Auth.js v5 beta ou Better Auth; edição de dados pelo jogador na dashboard; conteúdo adulto no catálogo global; dados dos previews da Vercel.
- Termos de uso das APIs (AniList, IGDB, TMDB: uso não comercial; TMDB exige atribuição) e direitos de imagem dos personagens.

## 4. Pendências do dono
- Instalar o rtk (a instalação foi bloqueada nesta sessão).
- Criar contas e chaves: Supabase, Twitch (IGDB), TMDB, aplicação OAuth do Discord. Colocar os segredos só no `.env` local e na Vercel, nunca no chat nem no Git.
- Revisar visualmente as cartas e prévias em `.cache/test-cards/png/` e `.cache/test-cards/embed/`.
- Decidir se o Git local (vários commits depois do primeiro push) vai para o GitHub.
