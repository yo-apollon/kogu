import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  fakeCtx,
  fakeUser,
  seedGuild,
  seedMember,
  setupTestDb,
  uid,
  type TestDb,
} from "../economy/helpers.js";

type GuildConfigMod = typeof import("../../../src/core/middleware/guildConfig.js");
type MemoryMod = typeof import("../../../src/infra/redis/memoryStore.js");
type ConfigSvc = typeof import("../../../src/modules/config/service.js");
type Eco = typeof import("../../../src/modules/economy/service.js");
type Sync = typeof import("../../../src/core/guildSync.js");
type Client = typeof import("../../../src/infra/db/client.js");

let t: TestDb;
let gc: GuildConfigMod;
let mem: MemoryMod;
let cfg: ConfigSvc;
let eco: Eco;
let sync: Sync;
let client: Client;

beforeAll(async () => {
  t = await setupTestDb();
  gc = await import("../../../src/core/middleware/guildConfig.js");
  mem = await import("../../../src/infra/redis/memoryStore.js");
  cfg = await import("../../../src/modules/config/service.js");
  eco = await import("../../../src/modules/economy/service.js");
  sync = await import("../../../src/core/guildSync.js");
  client = await import("../../../src/infra/db/client.js");
}, 120_000);
afterAll(async () => {
  await t?.stop();
}, 60_000);

async function versionOf(id: string): Promise<number> {
  const [r] = await t.sql`SELECT config_version AS v FROM guilds WHERE id = ${id}`;
  return r.v as number;
}

describe("guildConfig: propagacao por config_version", () => {
  it("sem camada KV: mudanca externa com config_version vale apos o TTL local", async () => {
    const kv = new mem.MemoryStore();
    let now = 1_000_000;
    const svc = gc.createGuildConfigService({
      kv,
      db: client.db,
      kvLayer: false,
      now: () => now,
      localTtlMs: 30_000,
    });
    const id = uid("gc");
    expect((await svc.get(id)).prefix).toBe("$");
    // A camada KV esta desligada: nada foi gravado.
    expect(await kv.get(gc.guildConfigKey(id))).toBeNull();

    await t.sql`UPDATE guilds SET prefix = '?', config_version = config_version + 1 WHERE id = ${id}`;
    expect((await svc.get(id)).prefix).toBe("$"); // dentro do TTL local

    now += 31_000;
    expect((await svc.get(id)).prefix).toBe("?");
  });

  it("sem camada KV: versao igual mantem o valor sem reler a linha", async () => {
    const kv = new mem.MemoryStore();
    let now = 5_000_000;
    const svc = gc.createGuildConfigService({
      kv,
      db: client.db,
      kvLayer: false,
      now: () => now,
      localTtlMs: 30_000,
    });
    const id = uid("gc");
    await svc.get(id);
    // Mudanca SEM incrementar a versao: a validacao nao relê a linha (e o contrato do config_version).
    await t.sql`UPDATE guilds SET prefix = '#' WHERE id = ${id}`;
    now += 31_000;
    expect((await svc.get(id)).prefix).toBe("$");
    // E o TTL local foi renovado.
    now += 31_000;
    await t.sql`UPDATE guilds SET config_version = config_version + 1 WHERE id = ${id}`;
    expect((await svc.get(id)).prefix).toBe("#");
  });

  it("com camada KV: config_version diferente ignora a copia velha do KV", async () => {
    const kv = new mem.MemoryStore();
    let now = 9_000_000;
    const svc = gc.createGuildConfigService({ kv, db: client.db, now: () => now });
    const id = uid("gc");
    await svc.get(id);
    expect(await kv.get(gc.guildConfigKey(id))).not.toBeNull();

    await t.sql`UPDATE guilds SET prefix = '%', config_version = config_version + 1 WHERE id = ${id}`;
    now += 31_000;
    expect((await svc.get(id)).prefix).toBe("%");
  });

  it("linha removida: recria com os padroes", async () => {
    const kv = new mem.MemoryStore();
    let now = 20_000_000;
    const svc = gc.createGuildConfigService({ kv, db: client.db, kvLayer: false, now: () => now });
    const id = uid("gc");
    await svc.get(id);
    await t.sql`DELETE FROM guilds WHERE id = ${id}`;
    now += 31_000;
    expect((await svc.get(id)).prefix).toBe("$");
    expect(await versionOf(id)).toBe(0);
  });

  it("applyGuildSetting incrementa config_version e updated_at na mesma escrita", async () => {
    const g = uid("gs");
    await cfg.applyGuildSetting(g, "rolls", 7, { prefix: "$" });
    expect(await versionOf(g)).toBe(1); // criada ja com a versao 1
    const [before] = await t.sql`SELECT updated_at FROM guilds WHERE id = ${g}`;
    await new Promise((r) => setTimeout(r, 20));
    await cfg.applyGuildSetting(g, "prefix", "!!", { prefix: "$" });
    expect(await versionOf(g)).toBe(2);
    const [after] = await t.sql`SELECT updated_at, prefix, base_rolls FROM guilds WHERE id = ${g}`;
    expect(after.prefix).toBe("!!");
    expect(after.base_rolls).toBe(7);
    expect((after.updated_at as Date).getTime()).toBeGreaterThan(
      (before.updated_at as Date).getTime()
    );
  });
});

describe("guildSync", () => {
  it("upsert cria/atualiza metadados e reativa bot_present", async () => {
    const id = uid("sync");
    await sync.upsertGuilds(client.db, [{ id, name: "Servidor A", icon: "abc" }]);
    let [row] = await t.sql`SELECT name, icon, bot_present, prefix, config_version FROM guilds WHERE id = ${id}`;
    expect(row).toMatchObject({ name: "Servidor A", icon: "abc", bot_present: true, prefix: "$" });
    expect(row.config_version).toBe(0);

    await sync.markGuildAbsent(client.db, id);
    [row] = await t.sql`SELECT bot_present FROM guilds WHERE id = ${id}`;
    expect(row.bot_present).toBe(false);

    await sync.upsertGuilds(client.db, [{ id, name: "Servidor B", icon: null }]);
    [row] = await t.sql`SELECT name, icon, bot_present, config_version FROM guilds WHERE id = ${id}`;
    expect(row).toMatchObject({ name: "Servidor B", icon: null, bot_present: true });
    expect(row.config_version).toBe(0); // metadados nao contam como mudanca de config
  });

  it("markMissingGuildsAbsent marca so as que sumiram", async () => {
    const keep = uid("keep");
    const gone = uid("gone");
    await sync.upsertGuilds(client.db, [
      { id: keep, name: "K", icon: null },
      { id: gone, name: "G", icon: null },
    ]);
    await sync.markMissingGuildsAbsent(client.db, [keep]);
    const rows = await t.sql`SELECT id, bot_present FROM guilds WHERE id IN (${keep}, ${gone})`;
    expect(rows.find((r) => r.id === keep)?.bot_present).toBe(true);
    expect(rows.find((r) => r.id === gone)?.bot_present).toBe(false);
  });
});

describe("economia: perfil e last_daily_at", () => {
  it("ensureUser grava avatar/global_name quando informados e nao os apaga quando omitidos", async () => {
    const u = uid("usr");
    await eco.ensureUser(client.db, u, "nome", { avatar: "hash1", globalName: "Nome Global" });
    let [row] = await t.sql`SELECT username, avatar, global_name FROM users WHERE id = ${u}`;
    expect(row).toMatchObject({ username: "nome", avatar: "hash1", global_name: "Nome Global" });

    await eco.ensureUser(client.db, u, "nome");
    [row] = await t.sql`SELECT avatar, global_name FROM users WHERE id = ${u}`;
    expect(row).toMatchObject({ avatar: "hash1", global_name: "Nome Global" });

    await eco.ensureUser(client.db, u, "nome", { avatar: null });
    [row] = await t.sql`SELECT avatar, global_name FROM users WHERE id = ${u}`;
    expect(row).toMatchObject({ avatar: null, global_name: "Nome Global" });
  });

  it("claimDaily grava guild_members.last_daily_at", async () => {
    const g = uid("gd");
    const u = uid("ud");
    await seedGuild(t.sql, g);
    await seedMember(t.sql, g, u);
    const before = Date.now();
    await eco.claimDaily(g, u, { profile: { avatar: "av", globalName: "G" } });
    const [row] = await t.sql`SELECT last_daily_at FROM guild_members WHERE guild_id = ${g} AND user_id = ${u}`;
    expect((row.last_daily_at as Date).getTime()).toBeGreaterThanOrEqual(before - 1000);
    const [usr] = await t.sql`SELECT avatar FROM users WHERE id = ${u}`;
    expect(usr.avatar).toBe("av");
  });

  it("o comando $daily repassa avatar e nome global", async () => {
    const cmds = await import("../../../src/modules/economy/commands.js");
    const g = uid("gc2");
    const id = uid("uc2");
    await seedGuild(t.sql, g);
    const user = { ...fakeUser(id, "cmduser"), avatar: "cmdhash", globalName: "Cmd Global" };
    const { ctx } = fakeCtx({ guildId: g, user });
    await cmds.dailyCommand.execute(ctx);
    const [usr] = await t.sql`SELECT avatar, global_name FROM users WHERE id = ${id}`;
    expect(usr).toMatchObject({ avatar: "cmdhash", global_name: "Cmd Global" });
  });
});