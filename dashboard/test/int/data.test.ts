import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { setupTestEnv, type TestEnv } from "./harness";
import { rateLimit, rateLimitWrite } from "@/server/ratelimit";
import { auditInsertSql, writeAudit } from "@/server/audit";
import { listAccessibleGuilds } from "@/server/guilds";
import { closeAllDbs, getRoDb, getRwDb } from "@/server/db";

let env: TestEnv;
beforeAll(async () => {
  env = await setupTestEnv();
}, 180_000);
afterAll(async () => {
  await closeAllDbs();
  await env?.stop();
}, 60_000);

const G1 = "100000000000000001";
const G2 = "100000000000000002";
const G3 = "100000000000000003";
const G4 = "100000000000000004";

async function pgError(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    // drizzle embrulha o erro do driver em `cause`.
    const c = (e as { cause?: { message?: string } }).cause;
    return c?.message ?? (e as Error).message;
  }
  return "";
}

describe("papeis (docs/supabase-roles.sql)", () => {
  it("dashboard_ro le mas nao escreve", async () => {
    await env.admin`INSERT INTO guilds (id, name) VALUES (${G1}, 'Alfa') ON CONFLICT DO NOTHING`;
    const rows = await env.ro.execute<{ id: string }>(sql`SELECT id FROM guilds WHERE id = ${G1}`);
    expect(rows).toHaveLength(1);
    expect(await pgError(env.ro.execute(sql`INSERT INTO guilds (id) VALUES ('999')`))).toMatch(/permission denied/);
    expect(await pgError(env.ro.execute(sql`UPDATE guilds SET prefix = '!' WHERE id = ${G1}`))).toMatch(/permission denied/);
    expect(await pgError(env.ro.execute(sql`DELETE FROM guilds WHERE id = ${G1}`))).toMatch(/permission denied/);
    expect(await pgError(env.ro.execute(sql`INSERT INTO dashboard_rate_limit (key) VALUES ('x')`))).toMatch(/permission denied/);
  });

  it("dashboard_rw escreve so onde permitido", async () => {
    await env.rw.execute(sql`UPDATE guilds SET prefix = '!', config_version = config_version + 1 WHERE id = ${G1}`);
    expect(await pgError(env.rw.execute(sql`UPDATE guilds SET allow_adult = true WHERE id = ${G1}`))).toMatch(/permission denied/);
    expect(await pgError(env.rw.execute(sql`UPDATE guilds SET bot_present = false WHERE id = ${G1}`))).toMatch(/permission denied/);
    expect(await pgError(env.rw.execute(sql`DELETE FROM guilds WHERE id = ${G1}`))).toMatch(/permission denied/);
    expect(await pgError(env.rw.execute(sql`UPDATE users SET is_vip = true`))).toMatch(/permission denied/);
    expect(await pgError(env.rw.execute(sql`DELETE FROM guild_members`))).toMatch(/permission denied/);
    expect(await pgError(env.rw.execute(sql`INSERT INTO guild_members (guild_id, user_id) VALUES (${G1}, '1')`))).toMatch(/permission denied/);
  });
});

describe("rateLimit", () => {
  it("11a chamada na janela e negada", async () => {
    const key = `t:${Math.random()}`;
    const results = [];
    for (let i = 0; i < 11; i++) results.push(await rateLimit({ key, limit: 10, windowSec: 60, db: env.rw }));
    expect(results.slice(0, 10).every((r) => r.ok)).toBe(true);
    expect(results[0]?.remaining).toBe(9);
    expect(results[9]?.remaining).toBe(0);
    expect(results[10]?.ok).toBe(false);
    expect(results[10]?.remaining).toBe(0);
    expect(results[10]!.resetAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("janela reinicia depois de windowSec", async () => {
    const key = `w:${Math.random()}`;
    const t0 = new Date("2030-01-01T00:00:00Z");
    for (let i = 0; i < 3; i++) await rateLimit({ key, limit: 2, windowSec: 60, db: env.rw, now: t0 });
    expect((await rateLimit({ key, limit: 2, windowSec: 60, db: env.rw, now: new Date(t0.getTime() + 59_000) })).ok).toBe(false);
    const after = await rateLimit({ key, limit: 2, windowSec: 60, db: env.rw, now: new Date(t0.getTime() + 60_000) });
    expect(after.ok).toBe(true);
    expect(after.remaining).toBe(1);
    expect(after.resetAt.toISOString()).toBe("2030-01-01T00:02:00.000Z");
  });

  it("e atomico sob concorrencia", async () => {
    const key = `c:${Math.random()}`;
    const rs = await Promise.all(Array.from({ length: 25 }, () => rateLimit({ key, limit: 10, windowSec: 60, db: env.rw })));
    expect(rs.filter((r) => r.ok)).toHaveLength(10);
  });

  it("chaves independentes por usuario+guilda e atalho de escrita", async () => {
    for (let i = 0; i < 10; i++) expect((await rateLimitWrite("u-a", G1, env.rw)).ok).toBe(true);
    expect((await rateLimitWrite("u-a", G1, env.rw)).ok).toBe(false);
    expect((await rateLimitWrite("u-a", G2, env.rw)).ok).toBe(true);
    expect((await rateLimitWrite("u-b", G1, env.rw)).ok).toBe(true);
  });

  it("valida parametros", async () => {
    await expect(rateLimit({ key: "", limit: 1, windowSec: 1, db: env.rw })).rejects.toThrow();
    await expect(rateLimit({ key: "k", limit: 0, windowSec: 1, db: env.rw })).rejects.toThrow();
  });
});

describe("audit", () => {
  it("grava na mesma CTE da escrita auditada", async () => {
    await env.rw.execute(sql`
      WITH upd AS (UPDATE guilds SET prefix = '?' WHERE id = ${G1} RETURNING id),
           aud AS (${auditInsertSql({
             guildId: G1,
             actorUserId: "42",
             action: "config.update",
             before: { prefix: "!" },
             after: { prefix: "?" },
           })})
      SELECT id FROM upd`);
    const rows = await env.admin`SELECT guild_id, actor_user_id, source, action, before, after FROM dashboard_audit_log WHERE guild_id = ${G1}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor_user_id: "42",
      source: "dashboard",
      action: "config.update",
      before: { prefix: "!" },
      after: { prefix: "?" },
    });
  });

  it("before/after nulos e valores com aspas nao quebram o SQL", async () => {
    await writeAudit({ guildId: G1, actorUserId: "42", action: "series.disable", after: { n: "o'brien\"; DROP TABLE x;--" } }, env.rw);
    const [r] = await env.admin`SELECT before, after FROM dashboard_audit_log WHERE action = 'series.disable'`;
    expect(r?.before).toBeNull();
    expect(r?.after).toEqual({ n: "o'brien\"; DROP TABLE x;--" });
  });

  it("rejeita action invalida", () => {
    expect(() => auditInsertSql({ guildId: G1, actorUserId: "1", action: "x'; --" })).toThrow();
  });

  it("dashboard_rw nao consegue alterar nem apagar auditoria", async () => {
    expect(await pgError(env.rw.execute(sql`DELETE FROM dashboard_audit_log`))).toMatch(/permission denied/);
    expect(await pgError(env.rw.execute(sql`UPDATE dashboard_audit_log SET action = 'x'`))).toMatch(/permission denied/);
  });
});

describe("listAccessibleGuilds", () => {
  const mk = (id: string, name: string, permissions: string, owner = false) => ({ id, name, icon: null, owner, permissions });
  const fakeFetch = (list: unknown[]) =>
    (async () => new Response(JSON.stringify(list), { status: 200 })) as unknown as typeof fetch;

  it("interseccao Discord x bot_present, com permissoes, ordenada por nome", async () => {
    await env.admin`INSERT INTO guilds (id, name, icon, bot_present) VALUES
      (${G2}, 'Zeta', 'ic2', true), (${G3}, 'Beta', NULL, true), (${G4}, 'Sem bot', NULL, false)
      ON CONFLICT DO NOTHING`;
    const discord = {
      fetch: fakeFetch([
        mk(G2, "Zeta", "8"),
        mk(G3, "Beta", "32"),
        mk(G4, "Sem bot", "8"),
        mk(G1, "Alfa", "0"),
        mk("100000000000000099", "Nao existe no banco", "8", true),
      ]),
      cache: new Map(),
    };
    const out = await listAccessibleGuilds({ userId: "42", accessToken: "t" }, { db: env.ro, discord });
    expect(out.map((g) => g.id)).toEqual([G1, G3, G2]); // Alfa, Beta, Zeta
    expect(out.find((g) => g.id === G2)).toMatchObject({ isAdmin: true, canManage: true, icon: "ic2" });
    expect(out.find((g) => g.id === G3)).toMatchObject({ isAdmin: false, canManage: true });
    expect(out.find((g) => g.id === G1)).toMatchObject({ isAdmin: false, canManage: false });
  });

  it("lista vazia do Discord => vazio sem consultar", async () => {
    const out = await listAccessibleGuilds(
      { userId: "43", accessToken: "t" },
      { db: env.ro, discord: { fetch: fakeFetch([]), cache: new Map() } }
    );
    expect(out).toEqual([]);
  });

  it("fresh rebusca; sem fresh usa cache", async () => {
    let calls = 0;
    const f = (async () => {
      calls++;
      return new Response(JSON.stringify([mk(G2, "Zeta", calls === 1 ? "8" : "0")]), { status: 200 });
    }) as unknown as typeof fetch;
    const discord = { fetch: f, cache: new Map() };
    const who = { userId: "44", accessToken: "t" };
    expect((await listAccessibleGuilds(who, { db: env.ro, discord }))[0]?.isAdmin).toBe(true);
    expect((await listAccessibleGuilds(who, { db: env.ro, discord }))[0]?.isAdmin).toBe(true);
    expect((await listAccessibleGuilds(who, { db: env.ro, discord, fresh: true }))[0]?.isAdmin).toBe(false);
    expect(calls).toBe(2);
  });
});

describe("db singleton", () => {
  it("getRoDb/getRwDb: um cliente por URL, e ro nao escreve", async () => {
    process.env.DATABASE_URL_RO = env.roUrl;
    process.env.DATABASE_URL_RW = env.rwUrl;
    expect(getRoDb()).toBe(getRoDb());
    expect(getRwDb()).toBe(getRwDb());
    expect(getRoDb()).not.toBe(getRwDb());
    expect(await pgError(getRoDb().execute(sql`UPDATE guilds SET prefix = 'x'`))).toMatch(/permission denied/);
    expect((await getRwDb().execute<{ one: number }>(sql`SELECT 1 AS one`))[0]?.one).toBe(1);
  });
});