import { describe, expect, it, vi } from "vitest";
vi.mock("../../../src/lib/logger.js", () => {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: log, childLogger: () => log };
});

import { deployCommands, isRealDiscordToken } from "../../../src/core/deploy.js";

const payload = [{ name: "ping", description: "x" }] as never;

describe("deployCommands", () => {
  it("com guildId registra comandos de guilda", async () => {
    const put = vi.fn(async () => []);
    const result = await deployCommands({
      token: "t",
      clientId: "123",
      guildId: "456",
      commands: payload,
      rest: { put },
    });
    expect(put).toHaveBeenCalledWith("/applications/123/guilds/456/commands", { body: payload });
    expect(result).toMatchObject({ scope: "guild", guildId: "456", count: 1, cleared: false });
  });

  it("sem guildId registra globais", async () => {
    const put = vi.fn(async () => []);
    const result = await deployCommands({
      token: "t",
      clientId: "123",
      commands: payload,
      rest: { put },
    });
    expect(put).toHaveBeenCalledWith("/applications/123/commands", { body: payload });
    expect(result.scope).toBe("global");
  });

  it("--clear envia lista vazia no mesmo escopo", async () => {
    const put = vi.fn(async () => []);
    const result = await deployCommands({
      token: "t",
      clientId: "123",
      guildId: "456",
      commands: payload,
      clear: true,
      rest: { put },
    });
    expect(put).toHaveBeenCalledWith("/applications/123/guilds/456/commands", { body: [] });
    expect(result).toMatchObject({ count: 0, cleared: true });
  });
});

describe("isRealDiscordToken", () => {
  it("aceita o formato de token e rejeita placeholders", () => {
    expect(
      isRealDiscordToken("MTIzNDU2Nzg5MDEyMzQ1Njc4.GabcDE.abcdefghijklmnopqrstuvwxyz0123456789")
    ).toBe(true);
    expect(isRealDiscordToken("seu_discord_bot_token_aqui")).toBe(false);
    expect(isRealDiscordToken("your_token_here")).toBe(false);
    expect(isRealDiscordToken("")).toBe(false);
    expect(isRealDiscordToken(undefined)).toBe(false);
  });
});
