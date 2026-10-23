import { vi } from "vitest";
import type { ChatInputCommandInteraction, Guild, Message } from "discord.js";
import type { GuildConfig } from "../../../src/core/contracts.js";

export function guildConfig(overrides: Partial<GuildConfig> = {}): GuildConfig {
  return {
    id: "g1",
    prefix: "$",
    locale: "pt-BR",
    baseRolls: 10,
    rollIntervalMin: 60,
    resetOffsetMin: 0,
    claimIntervalMin: 180,
    claimWindowSeconds: 45,
    snipeProtectionLevel: 0,
    snipeProtectionSeconds: 8,
    pactLimit: 8100,
    releaseBoostEnabled: true,
    allowAdult: false,
    ...overrides,
  };
}

export function provider(config: GuildConfig = guildConfig()) {
  return { get: vi.fn(async (_id: string) => config) };
}

export const fakeGuild = { id: "g1" } as unknown as Guild;

export interface FakeMessageOptions {
  content: string;
  bot?: boolean;
  inGuild?: boolean;
  userId?: string;
  hasPerm?: boolean;
}

export function fakeMessage(options: FakeMessageOptions) {
  const sent: unknown[] = [];
  const reply = vi.fn(async (payload: unknown) => {
    sent.push(payload);
    return { id: "reply" };
  });
  const send = vi.fn(async (payload: unknown) => {
    sent.push(payload);
    return { id: "sent" };
  });
  const message = {
    content: options.content,
    author: { id: options.userId ?? "u1", bot: options.bot ?? false },
    system: false,
    webhookId: null,
    guild: options.inGuild === false ? null : fakeGuild,
    member: { permissions: { has: vi.fn(() => options.hasPerm ?? true) } },
    channel: { send, sendTyping: vi.fn(async () => undefined) },
    createdTimestamp: Date.now() - 25,
    client: { ws: { ping: 42 } },
    reply,
  };
  return { message: message as unknown as Message, reply, send, sent };
}

export interface FakeSlashOptions {
  commandName: string;
  userId?: string;
  options?: Array<{ name: string; value: unknown }>;
  hasPerm?: boolean;
}

export function fakeSlash(opts: FakeSlashOptions) {
  const state = { deferred: false, replied: false };
  const interaction: Record<string, any> = {
    commandName: opts.commandName,
    user: { id: opts.userId ?? "u1" },
    guild: fakeGuild,
    guildId: "g1",
    member: { permissions: { has: vi.fn(() => opts.hasPerm ?? true) } },
    options: { data: opts.options ?? [] },
    createdTimestamp: Date.now() - 30,
    client: { ws: { ping: 55 } },
    get deferred() {
      return state.deferred;
    },
    get replied() {
      return state.replied;
    },
    isAutocomplete: () => false,
    isChatInputCommand: () => true,
    isMessageComponent: () => false,
    isModalSubmit: () => false,
    isRepliable: () => true,
    inCachedGuild: () => true,
    deferReply: vi.fn(async () => {
      state.deferred = true;
    }),
    reply: vi.fn(async () => {
      state.replied = true;
      return { id: "reply" };
    }),
    editReply: vi.fn(async () => {
      state.replied = true;
      return { id: "edit" };
    }),
    followUp: vi.fn(async () => ({ id: "follow" })),
  };
  return {
    interaction: interaction as unknown as ChatInputCommandInteraction,
    mock: interaction,
    state,
  };
}

/** Texto do primeiro embed (JSON) de um payload enviado. */
export function embedText(payload: any): string {
  const embed = payload?.embeds?.[0];
  const json = embed?.toJSON ? embed.toJSON() : embed;
  return [json?.title, json?.description, json?.footer?.text].filter(Boolean).join("\n");
}
