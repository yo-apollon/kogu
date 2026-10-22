-- Extensoes antes de qualquer tabela: os indices GIN trigram da migration 0002 dependem delas.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent;
