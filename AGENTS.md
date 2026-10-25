# Arqon: guia para agentes

Bot de Discord de gacha e colecionismo (clone próprio do Mudae) mais uma dashboard web. Este arquivo vale para qualquer agente ou ferramenta (Claude Code, Antigravity, outras). Leia também `docs/ROADMAP.md` (o que falta) e `docs/dashboard-plan.md` (plano da dashboard).

## Idioma
Responda, comente e escreva mensagens de commit em português, com acentuação correta. Identificadores de código ficam em inglês.

## Stack
- Bot: Node 22, TypeScript ESM (NodeNext, imports relativos com extensão `.js`), discord.js 14, drizzle-orm 0.33 + postgres-js, ioredis, BullMQ, @napi-rs/canvas, zod, pino, vitest.
- Banco: PostgreSQL. Produção planejada no Supabase (São Paulo). Em desenvolvimento, `npm run dev:local` sobe um Postgres embutido persistente em `.cache/devdb` e liga o bot; Redis fica em memória.
- Dashboard: pasta `dashboard/` (Next.js 16, React 19, Tailwind v4, Auth.js v5 com Discord, next-intl). Tem `package.json` próprio; instale e rode comandos dentro dela.

## Comandos (raiz do repositório)
- `npm run typecheck`, `npm run lint`, `npm test` (unitários), `npm run test:int` (integração, usa Postgres embutido; leva uns 2 min), `npm run test:perf` (orçamento de tempo do canvas, roda isolado).
- `npm run dev:local` liga o bot com banco local. `npm run deploy:commands` registra os slash commands no Discord.
- `npm run db:generate` (gera migration) e `npm run db:migrate`.
- Catálogo: `npm run sync:once -- --source=anilist --limit=200`, `npm run catalog:bootstrap`.
- Dashboard (dentro de `dashboard/`): `npm run dev`, `typecheck`, `lint`, `test`, `test:int`, `build`, `sync:shared`.

Antes de dar uma tarefa por concluída, `typecheck`, `lint` e os testes da área tocada precisam passar.

## Mapa do código
- `src/core`: registry de comandos, routers de prefixo e interação, middlewares (guildConfig, cooldown, permissões, errorBoundary), shutdown. Comandos são `defineCommand`-style (`AnyCommand`) e atendem prefixo e slash pelo mesmo `execute`.
- `src/modules/<módulo>`: summon, collection, economy, wishlist, config, catalog, admin, help, ping. Cada um exporta `commands` e `components`; o registro é em `src/modules/index.ts`.
- `src/infra/db`: schema drizzle, migrations (`.sql`, incluindo as custom que o drizzle-kit não gera), cliente preguiçoso. `src/infra/redis`: KV (Redis real ou MemoryStore só em dev/teste).
- `src/catalog`: pipeline rotativo de catálogo (adapters AniList, Jikan, IGDB, TMDB; scoring, quarentena, dedupe, jobs do worker).
- `src/canvas`: skins de carta (padrão `mudae`: arte limpa, borda branca fina), efeitos, pool de render. `src/ui`: design system dos embeds. `src/i18n` e `locales/*.json`: textos.
- `src/shared`: código puro compartilhado com a dashboard (não importe discord.js, redis ou i18n aí).
- `dashboard/src/generated`: cópia gerada de `src/shared` e do schema; não edite à mão.

## Regras do projeto
- Nunca `SELECT *` no caminho quente; selecione colunas. Toda escrita de jogo (rolls, pactos, saldo, relíquias) em transação, com operações atômicas no banco (UPDATE condicional) em vez de ler e depois gravar.
- Entidades só entram no sorteio com `status = 'ACTIVE'` e gênero diferente de `UNKNOWN`. Nunca sortear gênero desconhecido.
- Textos para o usuário: use chaves i18n (`t()`), com paridade exata entre `locales/pt-BR.json` e `locales/en-US.json`, e atualize `src/i18n/keys.ts` ao adicionar chave (o teste confere).
- Mensagens com menção: `allowedMentions` explícito; o padrão do `Client` é não mencionar ninguém.
- Segredos: `.env` e bancos (`*.db`) nunca vão para o Git. Não escreva tokens ou senhas em arquivos versionados, logs ou chat.
- Testes de integração usam `TEST_DATABASE_URL` e `TEST_REDIS_URL`, nunca `DATABASE_URL`/`REDIS_URL` (o dotenv carregaria o `.env` real). Sem essas variáveis eles sobem um Postgres embutido e pulam os testes de Redis real.
- Em PowerShell, `$env:X=''` apaga a variável; para testar sem logar no Discord use um token falso (`$env:DISCORD_TOKEN='placeholder'`), senão o dotenv carrega o token real e o bot entra online.
- Os testes de tempo do canvas só rodam com `CANVAS_PERF=1` (`npm run test:perf`).
- Dashboard: a autorização é sempre checada no servidor, no topo de toda página, layout e action (`dashboard/src/server/authz.ts`); guild fora das permissões do usuário responde 404. A dashboard nunca escreve em pactos, saldos, relíquias, ofertas ou entidades. Escritas de configuração usam as variantes `...Fresh`, versão otimista (`config_version`) e auditoria. Depois de mudar `src/shared` ou o schema do bot, rode `npm run sync:shared` na dashboard.
- Mudança de schema: gere migration com `npm run db:generate` (renomeie o arquivo se necessário), complemente com SQL manual o que o kit não gera e estenda `tests/integration/db/migrate.test.ts`.
- Não altere um teste existente só para ele passar; estenda ou corrija a causa.

## Fluxo de trabalho
- Commits pequenos e em português. Rode `git pull` antes de começar em uma ferramenta nova. Um agente por vez no mesmo arquivo.
- Enviar ao GitHub (`git push`) e qualquer ação externa (registrar slash commands, criar contas, mexer no Supabase ou na Vercel) só com pedido explícito do dono do projeto.
