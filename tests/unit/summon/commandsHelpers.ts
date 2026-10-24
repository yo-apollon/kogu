import { vi } from "vitest";
import type { Message } from "discord.js";
import type { CommandContext } from "../../../src/core/contracts.js";
import type { SummonComponentDeps } from "../../../src/modules/summon/components.js";
import type { SummonDeps } from "../../../src/modules/summon/commands.js";
import type { SummonResult } from "../../../src/modules/summon/service.js";
import type { RolledEntity } from "../../../src/modules/summon/rollEngine.js";
import { guildConfig } from "../core/helpers.js";

export function fakeEntity(over: Partial<RolledEntity> = {}): RolledEntity {
  return {
    id: 11,
    slug: "zero-two",
    name: "Zero Two",
    nameNative: null,
    universe: "ANIME",
    type: "CHARACTER",
    gender: "FEMALE",
    tier: "EPIC",
    description: null,
    isAdult: false,
    baseAether: 300,
    baseAtk: 90,
    baseDef: 70,
    baseSpd: 80,
    baseHp: 100,
    popularityRank: 12,
    likeRank: 34,
    claimRank: 56,
    likesCount: 0,
    claimsCount: 0,
    imageUrl: "https://s4.anilist.co/zero.png",
    seriesId: 1,
    seriesTitle: "DARLING in the FRANXX",
    franchiseId: null,
    pact: null,
    ...over,
  };
}

export function fakeResult(over: Partial<SummonResult> = {}, entity: Partial<RolledEntity> = {}): SummonResult {
  const base: SummonResult = {
    consumption: {
      source: "window",
      used: 1,
      limit: 10,
      remaining: 9,
      stacked: 0,
      window: 100,
      nextResetAt: 1_900_000_000_000,
    },
    entity: fakeEntity(entity),
    variant: "STANDARD",
    aetherValue: 380,
    awakeningKeys: 0,
    awardedKey: false,
    orbAether: null,
    offer: {
      id: 7,
      guildId: "g1",
      channelId: "chan-1",
      messageId: null,
      ownerUserId: "u1",
      entityId: 11,
      variant: "STANDARD",
      aetherValue: 380,
      status: "OPEN",
      expiresAt: new Date(Date.now() + 45_000),
      protectedUntil: null,
      claimedBy: null,
      claimedAt: null,
      pactId: null,
      orbAether: null,
      orbClaimedBy: null,
      orbClaimedAt: null,
      createdAt: new Date(),
    },
  };
  return { ...base, ...over };
}

/** Resultado de uma carta que ja tem dono (u9 / "bob"), com orbe de 76 Eter. */
export function fakeOwnedResult(): SummonResult {
  const r = fakeResult(
    { aetherValue: 380, awakeningKeys: 3, orbAether: 76, variant: "HOLO" },
    { pact: { id: 5, userId: "u9", variant: "HOLO", awakeningKeys: 3, ownerName: "bob" } }
  );
  r.offer.orbAether = 76;
  return r;
}

export function fakeCtx(
  over: Partial<{
    invokedAs: string;
    args: Record<string, unknown>;
    source: "prefix" | "slash";
    locale: "pt-BR" | "en-US";
    guildId: string;
    userId: string;
    username: string;
    messageId: string;
  }> = {}
) {
  const reply = vi.fn(
    async (_payload: unknown) => ({ id: over.messageId ?? "msg-1" }) as unknown as Message
  );
  const defer = vi.fn(async () => undefined);
  const source = over.source ?? "prefix";
  const guildId = over.guildId ?? "g1";
  const ctx = {
    source,
    message: source === "prefix" ? { channelId: "chan-1" } : undefined,
    interaction: source === "slash" ? { channelId: "chan-2" } : undefined,
    user: { id: over.userId ?? "u1", username: over.username ?? "alice" },
    member: null,
    guild: { id: guildId, members: { cache: new Map() } },
    guildConfig: guildConfig({ id: guildId }),
    locale: over.locale ?? "pt-BR",
    invokedAs: over.invokedAs ?? "w",
    args: over.args ?? {},
    rawArgs: [],
    defer,
    reply,
    followUp: vi.fn(async () => ({ id: "f" }) as unknown as Message),
    t: (key: string) => key,
  } as unknown as CommandContext<any>;
  return { ctx, reply, defer };
}

export function fakeSummonDeps(result: SummonResult, over: Partial<SummonDeps> = {}) {
  const deps = {
    loadGuildConfig: vi.fn(async () => ({ id: "g1" }) as never),
    performSummon: vi.fn(async () => result),
    refundRoll: vi.fn(async () => undefined),
    findWishers: vi.fn(async () => [] as string[]),
    loadPactExtras: vi.fn(async () => null),
    preferredSkin: vi.fn(async () => undefined),
    render: vi.fn(async () => Buffer.from("webp-bytes")),
    setOfferMessage: vi.fn(async () => undefined),
    ...over,
  };
  return deps as typeof deps & SummonDeps;
}

export interface FakeEmbed {
  author?: { name: string };
  description?: string;
  color?: number;
  footer?: { text: string };
  image?: { url: string };
}

export const FREE_EMBED: FakeEmbed = {
  author: { name: "Zero Two" },
  description: "DARLING in the FRANXX â™€\n*Roleta Animanga*  Â·  **380** ðŸ’ ",
  color: 0x2b2d31,
  footer: { text: "Livre para Pacto" },
  image: { url: "attachment://card.webp" },
};

export function fakeButton(
  over: Partial<{
    customId: string;
    userId: string;
    username: string;
    embeds: FakeEmbed[];
    guildId: string | null;
    channel: unknown;
  }> = {}
) {
  const send = vi.fn(async (_p: unknown) => ({}));
  const state = { acked: 0 };
  const ack = () => {
    state.acked++;
    if (state.acked > 1) throw new Error("InteractionAlreadyReplied");
    interaction.replied = true;
  };
  const interaction: Record<string, any> = {
    customId: over.customId ?? "sm:pact:7",
    guildId: over.guildId === undefined ? "g1" : over.guildId,
    user: {
      id: over.userId ?? "u2",
      username: over.username ?? "carol",
      displayAvatarURL: () => "https://cdn.discordapp.com/avatars/u2.png",
    },
    message: { embeds: over.embeds ?? [FREE_EMBED], edit: vi.fn(async (_p: unknown) => ({})) },
    channel: over.channel === undefined ? { send } : over.channel,
    replied: false,
    deferred: false,
    isButton: () => true,
    update: vi.fn(async (_p: unknown) => ack()),
    reply: vi.fn(async (_p: unknown) => ack()),
    followUp: vi.fn(async (_p: unknown) => ({})),
  };
  return { interaction: interaction as any, send, state };
}

export function fakeComponentDeps(over: Partial<SummonComponentDeps> = {}): SummonComponentDeps {
  return {
    claimPact: vi.fn(async (offerId: number, userId: string) => ({
      pactId: 5,
      offerId,
      guildId: "g1",
      userId,
      entityId: 11,
      variant: "FOIL" as const,
      aetherValue: 475,
      pactsUsed: 1,
      pactsPerWindow: 1,
      nextPactResetAt: 1_900_000_000_000,
    })),
    claimOrb: vi.fn(async (offerId: number) => ({
      offerId,
      guildId: "g1",
      entityId: 11,
      amount: 76,
      balance: 576,
    })),
    likeEntity: vi.fn(async () => ({ added: true, likesCount: 3 })),
    getOffer: vi.fn(async () => ({ id: 7, entityId: 11 }) as never),
    localeOf: vi.fn(async () => "pt-BR" as const),
    memberColor: vi.fn(async () => 0x112233),
    pactPosition: vi.fn(async () => 3),
    entityName: vi.fn(async () => "Zero Two"),
    ...over,
  } as SummonComponentDeps;
}

/** Texto do primeiro embed (ephemeral de erro) de uma chamada reply/update. */
export function firstEmbedJson(call: unknown): any {
  const payload = call as { embeds?: Array<{ toJSON?: () => unknown }> };
  const e = payload?.embeds?.[0];
  return e?.toJSON ? e.toJSON() : e;
}

export function rowIds(row: unknown): string[] {
  const json = (row as { toJSON(): { components: Array<{ custom_id?: string }> } }).toJSON();
  return json.components.map((c) => c.custom_id ?? "");
}

