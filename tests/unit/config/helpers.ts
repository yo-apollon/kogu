import { vi } from "vitest";

/** Contexto minimo de comando (prefixo) para exercitar `execute` com o servico mockado. */
export function fakeCtx(
  o: {
    args?: unknown;
    isAdmin?: boolean;
    locale?: "pt-BR" | "en-US";
    prefix?: string;
  } = {}
) {
  const replies: any[] = [];
  const reply = vi.fn(async (payload: unknown) => {
    replies.push(payload);
    return { id: "msg", edit: vi.fn(async () => undefined) };
  });
  const locale = o.locale ?? "pt-BR";
  const ctx: any = {
    source: "prefix",
    user: { id: "u1", username: "alice" },
    member: {
      displayName: "Alice",
      permissions: { has: vi.fn(() => o.isAdmin ?? false) },
    },
    guild: { id: "g1", name: "Guilda *Teste*" },
    guildConfig: { id: "g1", prefix: o.prefix ?? "$", locale, allowAdult: false },
    locale,
    invokedAs: "test",
    args: o.args ?? {},
    rawArgs: [],
    defer: vi.fn(async () => undefined),
    reply,
    followUp: reply,
    t: (key: string) => key,
  };
  return { ctx, replies, reply };
}

/** Titulo, descricao, campos e rodape do primeiro embed de uma resposta capturada. */
export function embedText(payload: any): string {
  const embed = payload?.embeds?.[0];
  const json = embed?.toJSON ? embed.toJSON() : embed;
  const fields = (json?.fields ?? []).map((f: any) => `${f.name}\n${f.value}`);
  return [json?.title, json?.description, ...fields, json?.footer?.text].filter(Boolean).join("\n");
}

/** AutocompleteInteraction minima. */
export function fakeAutocomplete(o: {
  focused?: { name: string; value: string };
  subcommand?: string | null;
  guildId?: string | null;
  booleans?: Record<string, boolean | null>;
}) {
  const respond = vi.fn(async (_choices: unknown) => undefined);
  const interaction: any = {
    guildId: o.guildId === undefined ? "g1" : o.guildId,
    user: { id: "u1" },
    options: {
      getFocused: vi.fn(() => o.focused ?? { name: "series", value: "" }),
      getSubcommand: vi.fn(() => o.subcommand ?? null),
      getBoolean: vi.fn((name: string) => o.booleans?.[name] ?? null),
    },
    respond,
  };
  return { interaction, respond };
}

/** ChatInputCommandInteraction minima para `slashArgs`. */
export function fakeSlashOptions(o: {
  subcommand?: string;
  strings?: Record<string, string>;
  booleans?: Record<string, boolean>;
  values?: Record<string, string | number>;
}) {
  return {
    options: {
      getSubcommand: vi.fn(() => o.subcommand ?? ""),
      getString: vi.fn((name: string) => o.strings?.[name] ?? null),
      getBoolean: vi.fn((name: string) => o.booleans?.[name] ?? null),
      get: vi.fn((name: string) => (o.values && name in o.values ? { value: o.values[name] } : null)),
    },
  } as any;
}

// ---------------------------------------------------------------------------
// Banco falso: registra cada statement e devolve linhas enfileiradas
// ---------------------------------------------------------------------------

export type DbOp = "insert" | "update" | "delete" | "select";

export interface RecordedStatement {
  op: DbOp;
  table: unknown;
  /** Chamadas encadeadas, na ordem (ex.: values, onConflictDoUpdate, returning). */
  calls: Array<{ method: string; args: unknown[] }>;
}

/** Argumentos da primeira chamada encadeada com o nome dado. */
export function argOf(stmt: RecordedStatement, method: string): any {
  return stmt.calls.find((c) => c.method === method)?.args[0];
}

export function createFakeDb() {
  const statements: RecordedStatement[] = [];
  const queues: Record<DbOp, unknown[][]> = { insert: [], update: [], delete: [], select: [] };

  function statement(op: DbOp, table: unknown) {
    const record: RecordedStatement = { op, table, calls: [] };
    statements.push(record);
    const proxy: any = new Proxy(
      {},
      {
        get(_t, prop: string) {
          if (prop === "then") {
            return (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
              Promise.resolve(queues[op].shift() ?? []).then(resolve, reject);
          }
          return (...args: unknown[]) => {
            record.calls.push({ method: prop, args });
            return proxy;
          };
        },
      }
    );
    return proxy;
  }

  const db: any = {
    insert: (table: unknown) => statement("insert", table),
    update: (table: unknown) => statement("update", table),
    delete: (table: unknown) => statement("delete", table),
    // select(cols).from(table): o registro guarda `cols` em calls[0] e a tabela em `from`
    select: (...cols: unknown[]) => {
      const proxy = statement("select", undefined);
      const record = statements[statements.length - 1]!;
      record.calls.push({ method: "select", args: cols });
      return proxy;
    },
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(db),
  };

  return {
    db,
    statements,
    /** Enfileira as linhas devolvidas pelo proximo statement do tipo `op`. */
    next(op: DbOp, rows: unknown[]) {
      queues[op].push(rows);
    },
    ofOp(op: DbOp) {
      return statements.filter((s) => s.op === op);
    },
    reset() {
      statements.length = 0;
      for (const q of Object.values(queues)) q.length = 0;
    },
  };
}

/** Instancia usada pelo `vi.mock` de infra/db/client.js (mesmo registro de modulos do teste). */
export const fakeDb = createFakeDb();
