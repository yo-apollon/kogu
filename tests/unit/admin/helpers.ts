import { vi } from "vitest";
import type { CommandContext } from "../../../src/core/contracts.js";
import { guildConfig } from "../core/helpers.js";

export interface FakeCtxOptions {
  args?: Record<string, unknown>;
  userId?: string;
  locale?: "pt-BR" | "en-US";
  prefix?: string;
  mentions?: Array<{ id: string; username: string }>;
}

/** CommandContext minimo: guarda tudo que foi respondido em `sent`. */
export function makeCtx(opts: FakeCtxOptions = {}) {
  const sent: any[] = [];
  const record = (payload: unknown) => {
    sent.push(payload);
    return { id: `m${sent.length}`, edit: vi.fn(async () => undefined) };
  };
  const users = new Map((opts.mentions ?? []).map((u) => [u.id, u]));
  const ctx = {
    source: "prefix",
    user: { id: opts.userId ?? "owner1", username: "dono" },
    member: { permissions: { has: vi.fn(() => true) } },
    guild: { id: "g1" },
    guildConfig: guildConfig({ prefix: opts.prefix ?? "$" }),
    message: { mentions: { users } },
    locale: opts.locale ?? "pt-BR",
    invokedAs: "x",
    args: opts.args ?? {},
    rawArgs: [],
    defer: vi.fn(async () => undefined),
    reply: vi.fn(async (p: unknown) => record(p)),
    followUp: vi.fn(async (p: unknown) => record(p)),
    t: (key: string) => key,
  };
  return { ctx: ctx as unknown as CommandContext, mock: ctx, sent };
}

/** Texto de todos os embeds (titulo, descricao, rodape) + content de um payload. */
export function textOf(payload: any): string {
  if (typeof payload === "string") return payload;
  const embeds = (payload?.embeds ?? []).map((e: any) => {
    const json = e?.toJSON ? e.toJSON() : e;
    return [json?.title, json?.description, json?.footer?.text].filter(Boolean).join("\n");
  });
  return [payload?.content, ...embeds].filter(Boolean).join("\n");
}
