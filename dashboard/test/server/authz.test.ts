import { describe, expect, it } from "vitest";
import type { Session } from "next-auth";
import { authorizeGuild, requireSession, requireStaff, type AuthzDeps } from "@/server/authz";
import type { AccessibleGuild } from "@/server/guilds";

const G = (id: string, isAdmin: boolean, canManage: boolean): AccessibleGuild => ({
  id,
  name: id,
  icon: null,
  isAdmin,
  canManage,
});
const session = { user: { id: "42", name: "n", avatar: null }, expires: "x" } as Session;

function deps(over: Partial<AuthzDeps> & { guilds?: AccessibleGuild[]; anon?: boolean } = {}): AuthzDeps & {
  fresh: boolean[];
} {
  const fresh: boolean[] = [];
  return {
    fresh,
    loadIdentity: async () =>
      over.anon ? null : { session, userId: "42", credentials: { userId: "42", accessToken: "tok" } },
    listGuilds: async (_i, f) => {
      fresh.push(f);
      return over.guilds ?? [];
    },
    ownerIds: over.ownerIds ?? (() => ["42"]),
  };
}

async function outcome(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    const digest = (e as { digest?: string }).digest ?? String(e);
    if (digest.startsWith("NEXT_REDIRECT")) return `redirect:${digest.split(";")[2]}`;
    if (digest.includes("404")) return "404";
    return `error:${digest}`;
  }
}

const GID = "100000000000000001";

describe("authz", () => {
  it("sem sessao => redirect /login", async () => {
    expect(await outcome(requireSession(deps({ anon: true })))).toBe("redirect:/login");
    expect(await outcome(authorizeGuild(GID, "member", {}, deps({ anon: true })))).toBe("redirect:/login");
    expect(await outcome(requireStaff(deps({ anon: true })))).toBe("redirect:/login");
  });

  // [isAdmin, canManage] => [member, manager, admin]
  const matrix: Array<[string, boolean, boolean, string, string, string]> = [
    ["nenhum", false, false, "ok", "404", "404"],
    ["manage guild (0x20)", false, true, "ok", "ok", "404"],
    ["administrator (0x8)", true, true, "ok", "ok", "ok"],
    ["dono", true, true, "ok", "ok", "ok"],
  ];
  it.each(matrix)("%s", async (_n, isAdmin, canManage, member, manager, admin) => {
    const d = deps({ guilds: [G(GID, isAdmin, canManage)] });
    expect(await outcome(authorizeGuild(GID, "member", {}, d))).toBe(member);
    expect(await outcome(authorizeGuild(GID, "manager", {}, d))).toBe(manager);
    expect(await outcome(authorizeGuild(GID, "admin", {}, d))).toBe(admin);
  });

  it("guilda fora da intersecao => 404 (nao 403)", async () => {
    const d = deps({ guilds: [G("100000000000000002", true, true)] });
    expect(await outcome(authorizeGuild(GID, "member", {}, d))).toBe("404");
  });

  it("guildId malformado => 404 sem consultar guildas", async () => {
    const d = deps({ guilds: [G(GID, true, true)] });
    expect(await outcome(authorizeGuild("1; DROP", "member", {}, d))).toBe("404");
    expect(d.fresh).toHaveLength(0);
  });

  it("contexto: userId vem da sessao e nao carrega token", async () => {
    const ctx = await authorizeGuild(GID, "member", {}, deps({ guilds: [G(GID, false, true)] }));
    expect(ctx.userId).toBe("42");
    expect(ctx.perms).toEqual({ isAdmin: false, canManage: true });
    expect(JSON.stringify(ctx)).not.toContain("tok");
  });

  it("fresh repassa fresh=true", async () => {
    const d = deps({ guilds: [G(GID, true, true)] });
    await authorizeGuild(GID, "admin", { fresh: true }, d);
    await authorizeGuild(GID, "admin", {}, d);
    expect(d.fresh).toEqual([true, false]);
  });

  it("staff: so OWNER_IDS", async () => {
    expect(await outcome(requireStaff(deps({ ownerIds: () => ["42"] })))).toBe("ok");
    expect(await outcome(requireStaff(deps({ ownerIds: () => ["7"] })))).toBe("404");
    expect(await outcome(requireStaff(deps({ ownerIds: () => [] })))).toBe("404");
  });
});