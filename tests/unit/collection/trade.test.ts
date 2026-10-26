import { describe, expect, it, vi } from "vitest";
import {
  activeTradeSessions,
  buildTradeCancelledEmbed,
  buildTradeComponents,
  buildTradeEmbed,
  buildTradeExpiredEmbed,
  buildTradeSuccessEmbed,
  createTradeSession,
  removeTradeSession,
  setTradeDepsForTest,
  tradeComponent,
  type TradePactInfo,
} from "../../../src/modules/collection/tradeViews.js";
import { executeTrade } from "../../../src/modules/collection/tradeService.js";
import { UserError } from "../../../src/lib/errors.js";

const mockPactA: TradePactInfo = {
  pactId: 101,
  entityId: 1,
  name: "Rem",
  series: "Re:Zero",
  variant: "HOLO",
  value: 1250,
};

const mockPactB: TradePactInfo = {
  pactId: 202,
  entityId: 2,
  name: "Emilia",
  series: "Re:Zero",
  variant: "COMMON",
  value: 980,
};

describe("Trade System - Sessao e Views", () => {
  it("cria sessao de troca com dados corretos e timeout", () => {
    const session = createTradeSession({
      guildId: "guild-1",
      channelId: "channel-1",
      userA: { id: "user-1", username: "Subaru", pact: mockPactA, accepted: true },
      userB: { id: "user-2", username: "Otto", pact: mockPactB, accepted: false },
      locale: "pt-BR",
    });

    expect(session.id).toBeDefined();
    expect(session.userA.id).toBe("user-1");
    expect(session.userA.pact?.name).toBe("Rem");
    expect(session.userA.accepted).toBe(true);
    expect(session.userB.id).toBe("user-2");
    expect(session.userB.pact?.name).toBe("Emilia");
    expect(session.userB.accepted).toBe(false);

    expect(activeTradeSessions.has(session.id)).toBe(true);
    removeTradeSession(session.id);
    expect(activeTradeSessions.has(session.id)).toBe(false);
  });

  it("renderiza embed de negociacao com informacoes de ambas as partes", () => {
    const session = createTradeSession({
      guildId: "guild-1",
      channelId: "channel-1",
      userA: { id: "user-1", username: "Subaru", pact: mockPactA, accepted: true },
      userB: { id: "user-2", username: "Otto", pact: mockPactB, accepted: false },
      locale: "pt-BR",
    });

    const embed = buildTradeEmbed(session);
    const data = embed.toJSON();

    expect(data.title).toContain("Mesa de Negociação");
    expect(data.fields?.[0].name).toContain("Subaru");
    expect(data.fields?.[0].value).toContain("Rem");
    expect(data.fields?.[0].value).toContain("Pronto para Trocar");

    expect(data.fields?.[1].name).toContain("Otto");
    expect(data.fields?.[1].value).toContain("Emilia");
    expect(data.fields?.[1].value).toContain("Aguardando confirmação");

    removeTradeSession(session.id);
  });

  it("renderiza embeds de sucesso, cancelamento e expirado", () => {
    const session = createTradeSession({
      guildId: "guild-1",
      channelId: "channel-1",
      userA: { id: "user-1", username: "Subaru", pact: mockPactA },
      userB: { id: "user-2", username: "Otto", pact: mockPactB },
      locale: "pt-BR",
    });

    const successEmbed = buildTradeSuccessEmbed(session, { pactA: mockPactA, pactB: mockPactB });
    expect(successEmbed.toJSON().title).toContain("Sucesso");
    expect(successEmbed.toJSON().description).toContain("Rem");
    expect(successEmbed.toJSON().description).toContain("Emilia");

    const cancelledEmbed = buildTradeCancelledEmbed(session, "Otto");
    expect(cancelledEmbed.toJSON().title).toContain("Cancelada");
    expect(cancelledEmbed.toJSON().description).toContain("Otto");

    const expiredEmbed = buildTradeExpiredEmbed(session);
    expect(expiredEmbed.toJSON().title).toContain("Expirada");

    removeTradeSession(session.id);
  });

  it("constroi componentes com menus e botoes", async () => {
    setTradeDepsForTest({
      getPactsPage: async (_g, userId) => ({
        items: userId === "user-1" ? [mockPactA] : [mockPactB],
        page: 1,
        totalPages: 2,
        total: 26,
      }),
    });

    const session = createTradeSession({
      guildId: "guild-1",
      channelId: "channel-1",
      userA: { id: "user-1", username: "Subaru", pact: mockPactA },
      userB: { id: "user-2", username: "Otto", pact: mockPactB },
      locale: "pt-BR",
    });

    const components = await buildTradeComponents(session);
    expect(components.length).toBeGreaterThanOrEqual(3);

    // Linha de acao tem botao de confirmar e cancelar
    const lastRow = components[components.length - 1];
    expect(lastRow.components.length).toBe(2);

    removeTradeSession(session.id);
    setTradeDepsForTest(null);
  });
});

describe("Trade System - Component Handler e Anti-Fraude", () => {
  it("rejeita interacao de usuario que nao e participante da troca", async () => {
    const session = createTradeSession({
      guildId: "guild-1",
      channelId: "channel-1",
      userA: { id: "user-1", username: "Subaru" },
      userB: { id: "user-2", username: "Otto" },
      locale: "pt-BR",
    });

    let replied = false;
    let ephemeral = false;
    const mockInteraction: any = {
      user: { id: "user-intruso", username: "Roswaal" },
      reply: vi.fn(async (opts) => {
        replied = true;
        ephemeral = Boolean(opts.flags);
      }),
    };

    await tradeComponent.handle(mockInteraction, ["accept", session.id]);

    expect(replied).toBe(true);
    expect(ephemeral).toBe(true);
    expect(session.userA.accepted).toBe(false);
    expect(session.userB.accepted).toBe(false);

    removeTradeSession(session.id);
  });

  it("reseta confirmacoes se qualquer participante alterar a carta (anti-bait-and-switch)", async () => {
    const session = createTradeSession({
      guildId: "guild-1",
      channelId: "channel-1",
      userA: { id: "user-1", username: "Subaru", pact: mockPactA, accepted: true },
      userB: { id: "user-2", username: "Otto", pact: mockPactB, accepted: true },
      locale: "pt-BR",
    });

    setTradeDepsForTest({
      getPact: async () => ({
        pactId: 999,
        entityId: 99,
        name: "Carta Trocada",
        series: "Teste",
        variant: "COMMON",
        value: 100,
      }),
      getPactsPage: async () => ({
        items: [],
        page: 1,
        totalPages: 1,
        total: 0,
      }),
    });

    const mockInteraction: any = {
      user: { id: "user-1", username: "Subaru" },
      isStringSelectMenu: () => true,
      values: ["999"],
      update: vi.fn(),
    };

    await tradeComponent.handle(mockInteraction, ["sel_init", session.id]);

    // O pacto mudou e AMBOS os aceites voltaram para false!
    expect(session.userA.pact?.name).toBe("Carta Trocada");
    expect(session.userA.accepted).toBe(false);
    expect(session.userB.accepted).toBe(false);

    removeTradeSession(session.id);
    setTradeDepsForTest(null);
  });

  it("executa a troca quando ambos os participantes confirmam", async () => {
    let executed = false;
    setTradeDepsForTest({
      execute: async () => {
        executed = true;
        return { pactA: mockPactA, pactB: mockPactB };
      },
      getPactsPage: async () => ({
        items: [mockPactA],
        page: 1,
        totalPages: 1,
        total: 1,
      }),
    });

    const session = createTradeSession({
      guildId: "guild-1",
      channelId: "channel-1",
      userA: { id: "user-1", username: "Subaru", pact: mockPactA, accepted: true },
      userB: { id: "user-2", username: "Otto", pact: mockPactB, accepted: false },
      locale: "pt-BR",
    });

    // Otto clica em aceitar
    const mockInteraction: any = {
      user: { id: "user-2", username: "Otto" },
      update: vi.fn(),
    };

    await tradeComponent.handle(mockInteraction, ["accept", session.id]);

    expect(executed).toBe(true);
    // Sessao foi finalizada e removida
    expect(activeTradeSessions.has(session.id)).toBe(false);

    setTradeDepsForTest(null);
  });

  it("cancela a troca imediatamente quando clicado em cancelar", async () => {
    const session = createTradeSession({
      guildId: "guild-1",
      channelId: "channel-1",
      userA: { id: "user-1", username: "Subaru", pact: mockPactA },
      userB: { id: "user-2", username: "Otto", pact: mockPactB },
      locale: "pt-BR",
    });

    let updatedEmbed: any = null;
    const mockInteraction: any = {
      user: { id: "user-2", username: "Otto" },
      update: vi.fn(async (payload) => {
        updatedEmbed = payload.embeds[0];
      }),
    };

    await tradeComponent.handle(mockInteraction, ["cancel", session.id]);

    expect(activeTradeSessions.has(session.id)).toBe(false);
    expect(updatedEmbed.toJSON().title).toContain("Cancelada");
  });
});

describe("Trade System - Validacoes de Negocio", () => {
  it("impede auto-troca", async () => {
    await expect(
      executeTrade({
        guildId: "guild-1",
        userA: { id: "user-1", pactId: 10 },
        userB: { id: "user-1", pactId: 20 },
      })
    ).rejects.toThrow(UserError);
  });

  it("impede troca sem nenhuma carta em ambos os lados", async () => {
    await expect(
      executeTrade({
        guildId: "guild-1",
        userA: { id: "user-1", pactId: null },
        userB: { id: "user-2", pactId: null },
      })
    ).rejects.toThrow(UserError);
  });
});
