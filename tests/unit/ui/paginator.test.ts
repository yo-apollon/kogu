import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import {
  activePaginators,
  createPaginator,
  disableComponents,
  handlePaginatorInteraction,
  paginatorKey,
  type PagePayload,
} from "../../../src/ui/components/paginator.js";
import { FakeKV, flattenComponents, mockButton, mockModalSubmit } from "./helpers.js";

const OWNER = "111";
const INTRUDER = "222";
const FIFTEEN_MIN = 15 * 60 * 1000;

const items = Array.from({ length: 25 }, (_, i) => `item-${i + 1}`);

function renderPage(pageItems: string[], page: number, total: number) {
  return { embeds: [{ description: pageItems.join(","), footer: { text: `${page}/${total}` } }] };
}

async function setup(opts: { ttlMs?: number; count?: number } = {}) {
  const kv = new FakeKV();
  const pg = await createPaginator({
    kv,
    ownerId: OWNER,
    items: items.slice(0, opts.count ?? 25),
    pageSize: 10,
    renderPage,
    ttlMs: opts.ttlMs,
  });
  return { kv, pg };
}

const btn = (id: string, action: string, user = OWNER) => mockButton(`pg:${id}:${action}`, user);
const lastUpdate = (i: { update: ReturnType<typeof vi.fn> }) =>
  i.update.mock.calls.at(-1)![0] as PagePayload;
const descriptionOf = (p: PagePayload) => (p.embeds[0] as { description: string }).description;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("paginator", () => {
  it("pagina unica: sem navegacao e sem estado no KV", async () => {
    const { kv, pg } = await setup({ count: 7 });
    expect(pg.totalPages).toBe(1);
    expect(pg.payload.components).toHaveLength(0);
    expect(kv.data.size).toBe(0);
  });

  it("primeira pagina: 5 botoes, primeira/anterior desabilitados, estado no KV com TTL de 15 min", async () => {
    const { kv, pg } = await setup();
    expect(pg.totalPages).toBe(3);
    expect(descriptionOf(pg.payload)).toBe(items.slice(0, 10).join(","));

    const buttons = flattenComponents(pg.payload.components);
    expect(buttons.map((b) => b.custom_id)).toEqual(
      ["first", "prev", "jump", "next", "last"].map((a) => `pg:${pg.id}:${a}`)
    );
    expect(buttons.map((b) => Boolean(b.disabled))).toEqual([true, true, false, false, false]);
    expect(buttons[2].label).toBe("1/3");

    expect(JSON.parse((await kv.get(paginatorKey(pg.id)))!)).toMatchObject({
      ownerId: OWNER,
      page: 1,
      totalPages: 3,
    });
    expect(kv.ttls.get(paginatorKey(pg.id))).toBe(FIFTEEN_MIN);
  });

  it("proxima, anterior, ultima e primeira", async () => {
    const { kv, pg } = await setup();

    const next = btn(pg.id, "next");
    await handlePaginatorInteraction(kv, next);
    expect(descriptionOf(lastUpdate(next))).toBe(items.slice(10, 20).join(","));
    expect(JSON.parse((await kv.get(paginatorKey(pg.id)))!).page).toBe(2);

    const last = btn(pg.id, "last");
    await handlePaginatorInteraction(kv, last);
    expect(descriptionOf(lastUpdate(last))).toBe(items.slice(20).join(","));
    const lastButtons = flattenComponents(lastUpdate(last).components);
    expect(lastButtons.map((b) => Boolean(b.disabled))).toEqual([false, false, false, true, true]);

    const prev = btn(pg.id, "prev");
    await handlePaginatorInteraction(kv, prev);
    expect(descriptionOf(lastUpdate(prev))).toBe(items.slice(10, 20).join(","));

    const first = btn(pg.id, "first");
    await handlePaginatorInteraction(kv, first);
    expect(descriptionOf(lastUpdate(first))).toBe(items.slice(0, 10).join(","));
  });

  it("clique em proxima na ultima pagina nao passa do limite", async () => {
    const { kv, pg } = await setup();
    await handlePaginatorInteraction(kv, btn(pg.id, "last"));
    const next = btn(pg.id, "next");
    await handlePaginatorInteraction(kv, next);
    expect(JSON.parse((await kv.get(paginatorKey(pg.id)))!).page).toBe(3);
  });

  it("jump abre modal e o envio navega para a pagina", async () => {
    const { kv, pg } = await setup();

    const jump = btn(pg.id, "jump");
    await handlePaginatorInteraction(kv, jump);
    expect(jump.showModal).toHaveBeenCalledTimes(1);
    const modal = (jump.showModal.mock.calls[0] as unknown[])[0] as { toJSON(): any };
    expect(modal.toJSON().custom_id).toBe(`pg:${pg.id}:jumpmodal`);
    expect(modal.toJSON().components[0].components[0].custom_id).toBe("page");

    const submit = mockModalSubmit(`pg:${pg.id}:jumpmodal`, OWNER, " 3 ");
    await handlePaginatorInteraction(kv, submit);
    expect(descriptionOf(lastUpdate(submit))).toBe(items.slice(20).join(","));
    expect(JSON.parse((await kv.get(paginatorKey(pg.id)))!).page).toBe(3);
  });

  it.each(["0", "4", "abc", "-1", "1.5", ""])(
    "jump invalido (%j) responde ephemeral sem navegar",
    async (value) => {
      const { kv, pg } = await setup();
      const submit = mockModalSubmit(`pg:${pg.id}:jumpmodal`, OWNER, value);
      await handlePaginatorInteraction(kv, submit);
      expect(submit.update).not.toHaveBeenCalled();
      expect(submit.reply).toHaveBeenCalledTimes(1);
      expect((submit.reply.mock.calls[0] as unknown[])[0]).toMatchObject({ flags: 64 });
      expect(JSON.parse((await kv.get(paginatorKey(pg.id)))!).page).toBe(1);
    }
  );

  it("ownership: outro usuario recebe ephemeral e nada muda", async () => {
    const { kv, pg } = await setup();
    const click = btn(pg.id, "next", INTRUDER);
    await handlePaginatorInteraction(kv, click);
    expect(click.update).not.toHaveBeenCalled();
    expect(click.reply).toHaveBeenCalledTimes(1);
    expect((click.reply.mock.calls[0] as unknown[])[0]).toMatchObject({ flags: 64 });
    expect(JSON.parse((await kv.get(paginatorKey(pg.id)))!).page).toBe(1);

    const jump = btn(pg.id, "jump", INTRUDER);
    await handlePaginatorInteraction(kv, jump);
    expect(jump.showModal).not.toHaveBeenCalled();
  });

  it("expiracao: desabilita botoes na mensagem e limpa o KV", async () => {
    const { kv, pg } = await setup();
    const edit = vi.fn(async () => undefined);
    pg.attach({ edit });
    expect(activePaginators()).toBeGreaterThan(0);

    await vi.advanceTimersByTimeAsync(FIFTEEN_MIN + 1);

    expect(edit).toHaveBeenCalledTimes(1);
    const components = (edit.mock.calls[0] as unknown[])[0] as {
      components: ActionRowBuilder<any>[];
    };
    const buttons = flattenComponents(components.components);
    expect(buttons).toHaveLength(5);
    expect(buttons.every((b) => b.disabled === true)).toBe(true);
    expect(await kv.get(paginatorKey(pg.id))).toBeNull();
  });

  it("clicar apos expirar desabilita a mensagem e avisa em ephemeral", async () => {
    const { kv, pg } = await setup();
    await vi.advanceTimersByTimeAsync(FIFTEEN_MIN + 1);

    const click = btn(pg.id, "next");
    (click.message as { components: unknown }).components = [pg.payload.components[0]!.toJSON()];
    await handlePaginatorInteraction(kv, click);

    expect(click.update).toHaveBeenCalledTimes(1);
    const updated = (click.update.mock.calls[0] as unknown[])[0] as {
      components: ActionRowBuilder<any>[];
    };
    expect(flattenComponents(updated.components).every((b) => b.disabled === true)).toBe(true);
    expect(click.followUp).toHaveBeenCalledTimes(1);
    expect((click.followUp.mock.calls[0] as unknown[])[0]).toMatchObject({ flags: 64 });
  });

  it("cada clique renova o TTL (expiracao deslizante)", async () => {
    const { kv, pg } = await setup();
    const edit = vi.fn(async () => undefined);
    pg.attach({ edit });

    await vi.advanceTimersByTimeAsync(FIFTEEN_MIN - 1000);
    await handlePaginatorInteraction(kv, btn(pg.id, "next"));
    await vi.advanceTimersByTimeAsync(FIFTEEN_MIN - 1000);
    expect(edit).not.toHaveBeenCalled();
    expect(await kv.get(paginatorKey(pg.id))).not.toBeNull();

    await vi.advanceTimersByTimeAsync(2000);
    expect(edit).toHaveBeenCalledTimes(1);
  });

  it("stop() encerra imediatamente", async () => {
    const { kv, pg } = await setup();
    const edit = vi.fn(async () => undefined);
    pg.attach({ edit });
    await pg.stop();
    expect(edit).toHaveBeenCalledTimes(1);
    expect(await kv.get(paginatorKey(pg.id))).toBeNull();
  });

  it("loader: busca cada pagina sob demanda", async () => {
    const kv = new FakeKV();
    const loader = vi.fn(async (page: number, size: number) => ({
      items: items.slice((page - 1) * size, page * size),
      total: items.length,
    }));
    const pg = await createPaginator({ kv, ownerId: OWNER, loader, pageSize: 10, renderPage });
    expect(pg.totalPages).toBe(3);
    expect(loader).toHaveBeenLastCalledWith(1, 10);

    const next = btn(pg.id, "next");
    await handlePaginatorInteraction(kv, next);
    expect(loader).toHaveBeenLastCalledWith(2, 10);
    expect(descriptionOf(lastUpdate(next))).toBe(items.slice(10, 20).join(","));
  });

  it("linhas extras do renderPage ficam abaixo da navegacao", async () => {
    const kv = new FakeKV();
    const extra = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("x:y").setLabel("Extra").setStyle(ButtonStyle.Primary)
    );
    const pg = await createPaginator({
      kv,
      ownerId: OWNER,
      items,
      pageSize: 10,
      renderPage: (it, p, t) => ({ ...renderPage(it, p, t), components: [extra] }),
    });
    expect(pg.payload.components).toHaveLength(2);
    expect(pg.payload.components[1]).toBe(extra);
  });
});

describe("disableComponents", () => {
  it("devolve copias desabilitadas sem mutar o original", () => {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("a:b").setLabel("A").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("a:c").setLabel("B").setStyle(ButtonStyle.Secondary)
    );
    const [copy] = disableComponents([row]);
    expect(flattenComponents([copy!]).every((b) => b.disabled === true)).toBe(true);
    expect(flattenComponents([row]).some((b) => b.disabled === true)).toBe(false);
  });

  it("aceita JSON cru da API", () => {
    const [copy] = disableComponents([
      { type: 1, components: [{ type: 2, style: 1, custom_id: "z:z", label: "Z" }] },
    ]);
    expect(flattenComponents([copy!])[0].disabled).toBe(true);
  });
});
