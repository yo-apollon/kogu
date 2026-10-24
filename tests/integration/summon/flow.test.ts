import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Client } from "discord.js";
import { fakeButton, fakeCtx, rowIds } from "../../unit/summon/commandsHelpers.js";
import {
  seedEntity,
  seedGuild,
  seedMember,
  seedSeries,
  setupTestDb,
  uid,
  type TestDb,
} from "./helpers.js";

// Fluxo ponta a ponta com Postgres real: invocar (runSummon) -> cliques nos botoes (handler `sm`)
// -> sweeper. So o renderer de arte e o Discord sao falsos.

let t: TestDb;
type Commands = typeof import("../../../src/modules/summon/commands.js");
type Components = typeof import("../../../src/modules/summon/components.js");
type Jobs = typeof import("../../../src/modules/summon/jobs.js");
type PoolMod = typeof import("../../../src/modules/summon/pool.js");
let commands: Commands;
let components: Components;
let jobs: Jobs;
let poolMod: PoolMod;

beforeAll(async () => {
  t = await setupTestDb();
  commands = await import("../../../src/modules/summon/commands.js");
  components = await import("../../../src/modules/summon/components.js");
  jobs = await import("../../../src/modules/summon/jobs.js");
  poolMod = await import("../../../src/modules/summon/pool.js");
}, 120_000);
afterAll(async () => {
  await poolMod?.stopPoolWatcher();
  await t?.stop();
}, 60_000);

const render = vi.fn(async (_input: unknown) => Buffer.from("webp-bytes"));
const deps = () => ({ ...commands.defaultSummonDeps, render });

/** Invoca como `invokedAs` e devolve o payload enviado e a oferta criada. */
async function summon(g: string, userId: string, invokedAs: string) {
  // (channel_id, message_id) e unico em roll_offers: cada invocacao precisa de um id de mensagem proprio.
  const messageId = uid("msg");
  const { ctx, reply } = fakeCtx({ invokedAs, guildId: g, userId, username: userId, messageId });
  await commands.runSummon(ctx, deps());
  return { ctx, reply, messageId };
}

async function lastOffer(g: string) {
  const [o] = await t.sql`
    SELECT id::int AS id, message_id, entity_id::int AS entity_id, status, claimed_by, orb_aether,
           orb_claimed_by
    FROM roll_offers WHERE guild_id = ${g} ORDER BY id DESC LIMIT 1`;
  return o;
}

const text = (call: unknown): string => {
  const p = call as { content?: string; embeds?: Array<{ toJSON(): { description?: string } }> };
  return p.content ?? p.embeds?.[0]?.toJSON().description ?? "";
};

describe("invocar -> pact concorrente -> 1 pacto", () => {
  it("duas pessoas e um duplo clique disputam a carta: 1 pacto, 1 atualizacao, 1 anuncio", async () => {
    const g = uid("g");
    const [roller, wisher, c1, c2] = [uid("u"), uid("u"), uid("u"), uid("u")];
    await seedGuild(t.sql, g, { baseRolls: 1, pactsPerWindow: 1 });
    for (const u of [roller, wisher, c1, c2]) await seedMember(t.sql, g, u);
    const s = await seedSeries(t.sql, "Darling");
    const e = await seedEntity(t.sql, "Flow Zero Two", { universe: "GAME", gender: "FEMALE", seriesId: s });
    await t.sql`INSERT INTO wishes (guild_id, user_id, entity_id) VALUES (${g}, ${wisher}, ${e})`;
    await poolMod.reloadPool();

    const { reply, messageId } = await summon(g, roller, "wg");

    // mensagem: arte anexada, botoes, wisher mencionado sem ping em mais ninguem
    expect(reply).toHaveBeenCalledTimes(1);
    const payload = reply.mock.calls[0][0] as any;
    expect(payload.files[0].name).toBe("card.webp");
    expect(payload.content).toContain(`<@${wisher}>`);
    expect(payload.allowedMentions).toEqual({ parse: [], users: [wisher] });
    const offer = await lastOffer(g);
    expect(offer.entity_id).toBe(e);
    expect(offer.message_id).toBe(messageId);
    expect(rowIds(payload.components[0])).toEqual([`sm:pact:${offer.id}`, `sm:like:${offer.id}`]);
    expect(render).toHaveBeenCalledWith(expect.objectContaining({ name: "Flow Zero Two", franchise: "Darling" }));

    // disputa
    const handler = components.createSummonComponentHandler();
    const clicks = [
      fakeButton({ customId: `sm:pact:${offer.id}`, userId: c1, username: "carol", guildId: g }),
      fakeButton({ customId: `sm:pact:${offer.id}`, userId: c2, username: "dave", guildId: g }),
      fakeButton({ customId: `sm:pact:${offer.id}`, userId: c1, username: "carol", guildId: g }),
    ];
    await Promise.all(clicks.map((c) => handler.handle(c.interaction, ["pact", String(offer.id)])));

    const [{ n }] = await t.sql`SELECT count(*)::int AS n FROM pacts WHERE guild_id = ${g}`;
    expect(n).toBe(1);
    const after = await lastOffer(g);
    expect(after.status).toBe("CLAIMED");
    expect([c1, c2]).toContain(after.claimed_by);

    const winners = clicks.filter((c) => c.interaction.update.mock.calls.length > 0);
    const losers = clicks.filter((c) => c.interaction.update.mock.calls.length === 0);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(2);
    // cada interacao respondida exatamente uma vez
    for (const c of clicks) expect(c.state.acked).toBe(1);
    for (const l of losers) {
      expect(l.interaction.reply).toHaveBeenCalledTimes(1);
      expect(text(l.interaction.reply.mock.calls[0][0])).toContain("Tarde demais");
      expect(l.send).not.toHaveBeenCalled();
    }
    const win = winners[0];
    const wonPayload = win.interaction.update.mock.calls[0][0];
    expect(wonPayload.components[0].toJSON().components[0]).toMatchObject({ disabled: true, custom_id: `sm:done:${offer.id}` });
    expect(wonPayload.embeds[0].toJSON().footer.text).toMatch(/^Pertence a .* ~~ 1 \/ 40 \[1\]$/);
    expect(win.send).toHaveBeenCalledTimes(1);

    const [member] = await t.sql`
      SELECT pacts_used FROM guild_members WHERE guild_id = ${g} AND user_id = ${after.claimed_by}`;
    expect(member.pacts_used).toBe(1);

    // like e idempotente por usuario: dois cliques = um like
    const likes = [1, 2].map(() =>
      fakeButton({ customId: `sm:like:${offer.id}`, userId: c2, username: "dave", guildId: g })
    );
    for (const like of likes) await handler.handle(like.interaction, ["like", String(offer.id)]);
    const [ent] = await t.sql`SELECT likes_count FROM entities WHERE id = ${e}`;
    expect(ent.likes_count).toBe(1);
    expect(text(likes[0].interaction.reply.mock.calls[0][0])).toContain("favoritos");
    expect(text(likes[1].interaction.reply.mock.calls[0][0])).toContain("já favoritou");

    // segundo roll na mesma janela: rolls esgotados com o horario exato do reset
    const second = await summon(g, roller, "wg");
    const sent = second.reply.mock.calls[0][0] as any;
    expect(sent.ephemeral).toBe(true);
    const { nextWindowStart } = await import("../../../src/lib/time.js");
    const expectedTs = Math.floor(nextWindowStart(60, 0) / 1000);
    expect(text(sent)).toContain("(0/1)");
    expect(text(sent)).toContain(`<t:${expectedTs}:t>`);
    expect(await t.sql`SELECT 1 FROM roll_offers WHERE guild_id = ${g}`).toHaveLength(1);
  }, 60_000);
});

describe("carta com dono: orbe absorvido uma unica vez", () => {
  it("dois cliques concorrentes creditam o orbe uma vez e o botao vira 'absorvido'", async () => {
    const g = uid("g");
    const [owner, roller, c1, c2] = [uid("u"), uid("u"), uid("u"), uid("u")];
    await seedGuild(t.sql, g);
    for (const u of [owner, roller, c1, c2]) await seedMember(t.sql, g, u);
    const e = await seedEntity(t.sql, "Flow Orb Target", { universe: "CINEMA", gender: "MALE" });
    await t.sql`INSERT INTO pacts (guild_id, user_id, entity_id, variant, awakening_keys, aether_at_bind)
                VALUES (${g}, ${owner}, ${e}, 'STANDARD', 2, 100)`;
    await poolMod.reloadPool();

    const { reply } = await summon(g, roller, "hc");
    const payload = reply.mock.calls[0][0] as any;
    const offer = await lastOffer(g);
    expect(offer.orb_aether).toBeGreaterThan(0);
    expect(rowIds(payload.components[0])).toEqual([`sm:like:${offer.id}`, `sm:orb:${offer.id}`]);
    expect(payload.embeds[0].toJSON().footer.text).toContain(`Pertence a ${owner}`);
    expect(payload.content).toBeUndefined();

    const handler = components.createSummonComponentHandler();
    const clicks = [c1, c2].map((u) =>
      fakeButton({ customId: `sm:orb:${offer.id}`, userId: u, username: u, guildId: g })
    );
    await Promise.all(clicks.map((c) => handler.handle(c.interaction, ["orb", String(offer.id)])));

    const winners = clicks.filter((c) => c.interaction.update.mock.calls.length > 0);
    expect(winners).toHaveLength(1);
    const loser = clicks.find((c) => c !== winners[0])!;
    expect(loser.interaction.update).not.toHaveBeenCalled();
    expect(text(loser.interaction.reply.mock.calls[0][0])).toContain("já foi absorvido");

    const wonPayload = winners[0].interaction.update.mock.calls[0][0];
    expect(wonPayload.components[0].toJSON().components[0]).toMatchObject({
      custom_id: `sm:orbdone:${offer.id}`,
      disabled: true,
    });
    expect(wonPayload.components[0].toJSON().components[0].label).toContain(`+${offer.orb_aether}`);

    const rows = await t.sql`
      SELECT user_id, aether_balance::int AS bal FROM guild_members
      WHERE guild_id = ${g} AND user_id IN (${c1}, ${c2})`;
    const bal = Object.fromEntries(rows.map((r) => [r.user_id, r.bal]));
    const winnerId = winners[0].interaction.user.id as string;
    expect(bal[winnerId]).toBe(offer.orb_aether);
    expect(bal[winnerId === c1 ? c2 : c1]).toBe(0);
  }, 60_000);
});

describe("sweeper com banco real", () => {
  it("expira a oferta, desabilita os botoes uma vez e cliques tardios recebem 'expirou'", async () => {
    const g = uid("g");
    const [roller, late] = [uid("u"), uid("u")];
    await seedGuild(t.sql, g);
    for (const u of [roller, late]) await seedMember(t.sql, g, u);
    await seedEntity(t.sql, "Flow Blade", { universe: "ANIME", gender: "ITEM", type: "WEAPON" });
    await poolMod.reloadPool();

    const { messageId } = await summon(g, roller, "ar");
    const offer = await lastOffer(g);
    expect(offer.message_id).toBe(messageId);
    await t.sql`UPDATE roll_offers SET expires_at = now() - interval '1 second' WHERE id = ${offer.id}`;

    const edit = vi.fn(async (_id: string, _payload: unknown) => ({}));
    const channel = { isTextBased: () => true, messages: { edit } };
    const client = {
      isReady: () => true,
      channels: { cache: new Map([["chan-1", channel]]), fetch: vi.fn() },
    } as unknown as Client;

    const stats = await jobs.runSweepOnce(client);
    expect(stats.edited).toBeGreaterThanOrEqual(1);
    const calls = edit.mock.calls.filter(([id]) => id === messageId);
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const payload = calls[0][1] as any;
    expect(payload.components[0].toJSON().components[0]).toMatchObject({
      custom_id: `sm:expired:${offer.id}`,
      disabled: true,
    });
    expect((await lastOffer(g)).status).toBe("EXPIRED");

    const before = edit.mock.calls.length;
    await jobs.runSweepOnce(client);
    expect(edit.mock.calls.length).toBe(before); // nada novo para varrer

    const click = fakeButton({ customId: `sm:pact:${offer.id}`, userId: late, guildId: g });
    await components.createSummonComponentHandler().handle(click.interaction, ["pact", String(offer.id)]);
    expect(click.interaction.update).not.toHaveBeenCalled();
    expect(text(click.interaction.reply.mock.calls[0][0])).toContain("expirou");
    const [{ n }] = await t.sql`SELECT count(*)::int AS n FROM pacts WHERE guild_id = ${g}`;
    expect(n).toBe(0);
  }, 60_000);
});
