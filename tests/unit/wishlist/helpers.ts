import { vi } from "vitest";

/** Contexto minimo de comando (prefixo) para exercitar `execute` com o servico mockado. */
export function fakeCtx(
  o: {
    args?: unknown;
    isAdmin?: boolean;
    allowAdult?: boolean;
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
    guildConfig: {
      id: "g1",
      prefix: o.prefix ?? "$",
      locale,
      allowAdult: o.allowAdult ?? false,
    },
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
      getFocused: vi.fn(() => o.focused ?? { name: "entity", value: "" }),
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
