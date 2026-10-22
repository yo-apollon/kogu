import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  confirm,
  handleConfirmInteraction,
  type ConfirmPayload,
} from "../../../src/ui/components/confirm.js";
import { createPanel, handlePanelInteraction, panelKey } from "../../../src/ui/components/panel.js";
import { assertOwner } from "../../../src/ui/components/ownership.js";
import { FakeKV, flattenComponents, mockButton, mockSelect } from "./helpers.js";

const OWNER = "111";
const INTRUDER = "222";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("panel", () => {
  const sections = [
    { id: "a", label: "Secao A", render: () => ({ embeds: [{ description: "A" }] }) },
    {
      id: "b",
      label: "Secao B",
      emoji: "🎲",
      render: async () => ({ embeds: [{ description: "B" }] }),
    },
  ];

  it("renderiza a secao inicial com select e estado no KV", async () => {
    const kv = new FakeKV();
    const panel = await createPanel({ kv, ownerId: OWNER, sections });
    expect((panel.payload.embeds[0] as any).description).toBe("A");
    const select = flattenComponents(panel.payload.components)[0];
    expect(select.custom_id).toBe(`pn:${panel.id}:select`);
    expect(select.options.map((o: any) => [o.value, Boolean(o.default)])).toEqual([
      ["a", true],
      ["b", false],
    ]);
    expect(JSON.parse((await kv.get(panelKey(panel.id)))!)).toMatchObject({
      ownerId: OWNER,
      section: "a",
    });
  });

  it("troca de secao e persiste a escolha", async () => {
    const kv = new FakeKV();
    const panel = await createPanel({ kv, ownerId: OWNER, sections });
    const pick = mockSelect(`pn:${panel.id}:select`, OWNER, ["b"]);
    await handlePanelInteraction(kv, pick);
    const payload = (pick.update.mock.calls[0] as unknown[])[0] as any;
    expect(payload.embeds[0].description).toBe("B");
    expect(flattenComponents(payload.components)[0].options.find((o: any) => o.default).value).toBe(
      "b"
    );
    expect(JSON.parse((await kv.get(panelKey(panel.id)))!).section).toBe("b");
  });

  it("ownership: outro usuario recebe ephemeral", async () => {
    const kv = new FakeKV();
    const panel = await createPanel({ kv, ownerId: OWNER, sections });
    const pick = mockSelect(`pn:${panel.id}:select`, INTRUDER, ["b"]);
    await handlePanelInteraction(kv, pick);
    expect(pick.update).not.toHaveBeenCalled();
    expect((pick.reply.mock.calls[0] as unknown[])[0]).toMatchObject({ flags: 64 });
  });

  it("secao desconhecida responde erro; expirado desabilita", async () => {
    const kv = new FakeKV();
    const panel = await createPanel({ kv, ownerId: OWNER, sections, ttlMs: 1000 });
    const bad = mockSelect(`pn:${panel.id}:select`, OWNER, ["zzz"]);
    await handlePanelInteraction(kv, bad);
    expect(bad.update).not.toHaveBeenCalled();
    expect(bad.reply).toHaveBeenCalledTimes(1);

    const edit = vi.fn(async () => undefined);
    panel.attach({ edit });
    await vi.advanceTimersByTimeAsync(1001);
    expect(edit).toHaveBeenCalledTimes(1);
    const rows = ((edit.mock.calls[0] as unknown[])[0] as any).components;
    expect(flattenComponents(rows)[0].disabled).toBe(true);

    const late = mockSelect(`pn:${panel.id}:select`, OWNER, ["a"]);
    await handlePanelInteraction(kv, late);
    expect(late.update).toHaveBeenCalledTimes(1);
    expect(late.followUp).toHaveBeenCalledTimes(1);
  });

  it("rejeita lista de secoes vazia", async () => {
    await expect(createPanel({ kv: new FakeKV(), ownerId: OWNER, sections: [] })).rejects.toThrow(
      RangeError
    );
  });
});

describe("confirm", () => {
  function start(opts: { timeoutMs?: number } = {}) {
    let sent!: ConfirmPayload;
    const edit = vi.fn(async () => undefined);
    const result = confirm({
      ownerId: OWNER,
      prompt: "Tem certeza?",
      timeoutMs: opts.timeoutMs,
      send: async (payload) => {
        sent = payload;
        return { edit };
      },
    });
    const ids = flattenComponents(sent.components).map((c) => c.custom_id as string);
    return { result, sent, edit, yesId: ids[0]!, noId: ids[1]! };
  }

  it("Sim resolve true e desabilita os botoes", async () => {
    const { result, yesId } = start();
    expect(yesId).toMatch(/^cf:[0-9a-f]+:yes$/);
    const click = mockButton(yesId, OWNER);
    await handleConfirmInteraction(click);
    await expect(result).resolves.toBe(true);
    const rows = ((click.update.mock.calls[0] as unknown[])[0] as any).components;
    expect(flattenComponents(rows).every((c) => c.disabled === true)).toBe(true);
  });

  it("Nao resolve false", async () => {
    const { result, noId } = start();
    await handleConfirmInteraction(mockButton(noId, OWNER));
    await expect(result).resolves.toBe(false);
  });

  it("outro usuario nao decide: recebe ephemeral e a confirmacao segue aberta", async () => {
    const { result, yesId, noId } = start();
    const intruder = mockButton(yesId, INTRUDER);
    await handleConfirmInteraction(intruder);
    expect(intruder.reply).toHaveBeenCalledTimes(1);
    expect((intruder.reply.mock.calls[0] as unknown[])[0]).toMatchObject({ flags: 64 });
    await handleConfirmInteraction(mockButton(noId, OWNER));
    await expect(result).resolves.toBe(false);
  });

  it("timeout resolve false e desabilita a mensagem", async () => {
    const { result, edit } = start({ timeoutMs: 5000 });
    await vi.advanceTimersByTimeAsync(5001);
    await expect(result).resolves.toBe(false);
    expect(edit).toHaveBeenCalledTimes(1);
    const rows = ((edit.mock.calls[0] as unknown[])[0] as any).components;
    expect(flattenComponents(rows).every((c) => c.disabled === true)).toBe(true);
  });

  it("clique orfao (apos resolver) desabilita e avisa", async () => {
    const { result, yesId } = start();
    await handleConfirmInteraction(mockButton(yesId, OWNER));
    await result;
    const again = mockButton(yesId, OWNER);
    await handleConfirmInteraction(again);
    expect(again.update).toHaveBeenCalledTimes(1);
    expect(again.followUp).toHaveBeenCalledTimes(1);
  });

  it("falha no envio resolve false", async () => {
    await expect(
      confirm({ ownerId: OWNER, prompt: "x", send: async () => Promise.reject(new Error("boom")) })
    ).resolves.toBe(false);
  });
});

describe("assertOwner", () => {
  it("dono passa sem responder", async () => {
    const i = mockButton("x:y:z", OWNER);
    await expect(assertOwner(i, OWNER, "pt-BR")).resolves.toBe(true);
    expect(i.reply).not.toHaveBeenCalled();
  });

  it("intruso recebe ephemeral localizado", async () => {
    const pt = mockButton("x:y:z", INTRUDER);
    await expect(assertOwner(pt, OWNER, "pt-BR")).resolves.toBe(false);
    const ptEmbed = ((pt.reply.mock.calls[0] as unknown[])[0] as any).embeds[0].toJSON();
    expect(ptEmbed.description).toContain("Apenas quem usou o comando");

    const en = mockButton("x:y:z", INTRUDER);
    await assertOwner(en, OWNER, "en-US");
    const enEmbed = ((en.reply.mock.calls[0] as unknown[])[0] as any).embeds[0].toJSON();
    expect(enEmbed.description).toContain("Only the person who used the command");
  });

  it("usa followUp quando ja respondeu", async () => {
    const i = mockButton("x:y:z", INTRUDER);
    i.replied = true;
    await assertOwner(i, OWNER, "pt-BR");
    expect(i.followUp).toHaveBeenCalledTimes(1);
    expect(i.reply).not.toHaveBeenCalled();
  });
});
