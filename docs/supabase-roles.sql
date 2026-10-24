-- =============================================================================
-- Papeis do Arqon no Supabase Postgres (bot + dashboard)
-- =============================================================================
-- Executar UMA vez, no SQL editor do Supabase, DEPOIS de aplicar as migrations
-- (`npm run db:migrate` com a conexao direta do papel postgres) e ANTES de apontar
-- o bot/dashboard para os novos usuarios. E idempotente: pode ser reexecutado
-- (por exemplo apos uma migration que cria tabelas).
--
-- SENHAS: nunca commitar valores reais. Os marcadores :'pwd_bot', :'pwd_ro' e
-- :'pwd_rw' sao variaveis do psql (`psql -v pwd_bot=... -f supabase-roles.sql`).
-- No SQL editor do Supabase nao ha variaveis: substitua cada marcador, ENTRE ASPAS
-- SIMPLES, por uma senha forte e unica gerada na hora (ex.: 'k3...'), execute e
-- NAO salve o script editado.
--
-- Papeis:
--   arqon_bot     dono das tabelas; usado pelo bot e pelas migrations.
--   dashboard_ro  SELECT em tudo; usado pelas leituras da dashboard (DATABASE_URL_RO).
--   dashboard_rw  herda o ro + escritas restritas as colunas/tabelas que a dashboard
--                 pode alterar (DATABASE_URL_RW, so nas Server Actions).
-- A dashboard NUNCA escreve em pactos, saldo, reliquias, ofertas nem entidades.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Criacao dos papeis (sem senha dentro do DO: variaveis do psql nao expandem em $$)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arqon_bot') THEN
    CREATE ROLE arqon_bot NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_ro') THEN
    CREATE ROLE dashboard_ro NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_rw') THEN
    CREATE ROLE dashboard_rw NOLOGIN;
  END IF;
END
$$;

ALTER ROLE arqon_bot    WITH LOGIN PASSWORD :'pwd_bot';
ALTER ROLE dashboard_ro WITH LOGIN PASSWORD :'pwd_ro';
ALTER ROLE dashboard_rw WITH LOGIN PASSWORD :'pwd_rw';

-- Nenhum dos tres e superusuario nem ignora RLS.
ALTER ROLE arqon_bot    NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
ALTER ROLE dashboard_ro NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
ALTER ROLE dashboard_rw NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

-- Limites defensivos para o papel que roda no serverless da dashboard.
ALTER ROLE dashboard_ro SET statement_timeout = '15s';
ALTER ROLE dashboard_rw SET statement_timeout = '15s';

-- O rw herda tudo do ro (INHERIT e o padrao).
GRANT dashboard_ro TO dashboard_rw;

-- ---------------------------------------------------------------------------
-- 2) arqon_bot passa a ser o dono do schema public (tabelas, sequencias, tipos)
-- ---------------------------------------------------------------------------
-- No Supabase o papel postgres nao e superusuario: precisa ser membro para transferir posse.
GRANT arqon_bot TO postgres;

GRANT USAGE, CREATE ON SCHEMA public TO arqon_bot;
GRANT USAGE ON SCHEMA public TO dashboard_ro;  -- o rw herda

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO arqon_bot', r.tablename);
  END LOOP;
  FOR r IN SELECT sequencename FROM pg_sequences WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER SEQUENCE public.%I OWNER TO arqon_bot', r.sequencename);
  END LOOP;
  FOR r IN
    SELECT t.typname
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typtype = 'e'
  LOOP
    EXECUTE format('ALTER TYPE public.%I OWNER TO arqon_bot', r.typname);
  END LOOP;
END
$$;

-- A tabela de controle das migrations (schema drizzle) tambem e do bot.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'drizzle') THEN
    EXECUTE 'ALTER SCHEMA drizzle OWNER TO arqon_bot';
    EXECUTE 'ALTER TABLE drizzle.__drizzle_migrations OWNER TO arqon_bot';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 3) Fechar o acesso da API publica do Supabase (PostgREST: anon / authenticated)
-- ---------------------------------------------------------------------------
-- O Arqon nao usa a API REST do Supabase; os dados do jogo nao podem ficar legiveis por ela.
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE arqon_bot IN SCHEMA public
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) dashboard_ro: SELECT em tudo (inclusive tabelas criadas por migrations futuras)
-- ---------------------------------------------------------------------------
GRANT SELECT ON ALL TABLES IN SCHEMA public TO dashboard_ro;
ALTER DEFAULT PRIVILEGES FOR ROLE arqon_bot IN SCHEMA public
  GRANT SELECT ON TABLES TO dashboard_ro;

-- ---------------------------------------------------------------------------
-- 5) dashboard_rw: escritas minimas (cada GRANT corresponde a uma tela de escrita)
-- ---------------------------------------------------------------------------
-- Configuracoes do servidor (Admin > Configuracoes). `config_version` e `updated_at` sobem na
-- mesma escrita; o bot revalida o cache de config por config_version (ate 30 s).
GRANT UPDATE (prefix, language, gamemode, base_rolls, claim_cooldown_minutes,
              claim_window_seconds, updated_at, config_version)
  ON public.guilds TO dashboard_rw;

-- Mudar a recarga do Pacto zera as janelas dos membros (mesmo efeito do $settimer no bot).
GRANT UPDATE (rolls_window, pact_window) ON public.guild_members TO dashboard_rw;

-- Series desativadas do servidor (Admin > Series desativadas).
GRANT INSERT, DELETE ON public.disabled_series TO dashboard_rw;

-- Garante a linha do usuario antes de gravar series desativadas (INSERT ... ON CONFLICT DO NOTHING).
GRANT INSERT (id, username) ON public.users TO dashboard_rw;

-- Auditoria e rate limit das proprias escritas.
GRANT INSERT ON public.dashboard_audit_log TO dashboard_rw;
GRANT INSERT, UPDATE ON public.dashboard_rate_limit TO dashboard_rw;

-- ---------------------------------------------------------------------------
-- 6) Verificacao rapida (opcional): deve listar so as escritas acima para dashboard_rw
-- ---------------------------------------------------------------------------
-- SELECT table_name, column_name, privilege_type
-- FROM information_schema.column_privileges
-- WHERE grantee = 'dashboard_rw' AND privilege_type <> 'SELECT'
-- ORDER BY table_name, column_name, privilege_type;