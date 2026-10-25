import { describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import type { JWT } from "next-auth/jwt";
import { credentialsFromToken, jwtCallback, sessionCallback } from "@/server/auth";
import { safeCallbackUrl } from "@/lib/safe-redirect";
import { hasSessionCookie } from "@/proxy";

const NOW = 1_800_000_000;
const base: JWT = {
  discordId: "42",
  name: "Nome",
  avatar: "abc",
  accessToken: "ACCESS",
  refreshToken: "REFRESH",
  expiresAt: NOW + 3600,
};

describe("jwtCallback", () => {
  it("login guarda identidade e tokens", async () => {
    const t = await jwtCallback(
      {
        token: { sub: "x", email: "a@b.c", picture: "p" },
        account: { providerAccountId: "42", access_token: "A", refresh_token: "R", expires_at: NOW + 100 },
        profile: { id: "42", username: "u", global_name: "G", avatar: "av" },
      },
      { nowSec: () => NOW }
    );
    expect(t).toMatchObject({ discordId: "42", name: "G", avatar: "av", accessToken: "A", refreshToken: "R", expiresAt: NOW + 100 });
    expect(t).not.toHaveProperty("email");
    expect(t).not.toHaveProperty("picture");
  });

  it("token valido passa intacto", async () => {
    expect(await jwtCallback({ token: base }, { nowSec: () => NOW })).toBe(base);
  });

  it("vencido sem refresh => null (novo login)", async () => {
    const t = { ...base, refreshToken: undefined };
    expect(await jwtCallback({ token: { ...t, expiresAt: NOW - 1 } }, { nowSec: () => NOW })).toBeNull();
  });

  it("vencido com refresh => renova", async () => {
    const f = vi.fn(async () =>
      new Response(JSON.stringify({ access_token: "NEW", refresh_token: "R2", expires_in: 604800 }), { status: 200 })
    );
    const t = await jwtCallback(
      { token: { ...base, expiresAt: NOW - 1, refreshToken: "R-ok" } },
      { nowSec: () => NOW, fetch: f as unknown as typeof fetch, clientId: "i", clientSecret: "s" }
    );
    expect(t).toMatchObject({ accessToken: "NEW", refreshToken: "R2", expiresAt: NOW + 604800 });
  });

  it("refresh recusado => null", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 400 }));
    const t = await jwtCallback(
      { token: { ...base, expiresAt: NOW - 1, refreshToken: "R-bad" } },
      { nowSec: () => NOW, fetch: f as unknown as typeof fetch, clientId: "i", clientSecret: "s" }
    );
    expect(t).toBeNull();
  });

  it("token sem identidade => null", async () => {
    expect(await jwtCallback({ token: {} }, { nowSec: () => NOW })).toBeNull();
  });
});

describe("sessionCallback", () => {
  it("expoe so { id, name, avatar }, sem tokens", () => {
    const s = sessionCallback({
      session: { user: { name: "x", email: "e", image: "i" }, expires: "2030-01-01" } as unknown as Session,
      token: base,
    });
    expect(s.user).toEqual({ id: "42", name: "Nome", avatar: "abc" });
    const dump = JSON.stringify(s);
    expect(dump).not.toContain("ACCESS");
    expect(dump).not.toContain("REFRESH");
    expect(dump).not.toContain("accessToken");
  });
});

describe("credentialsFromToken", () => {
  it("valido / vencido / ausente", () => {
    expect(credentialsFromToken(base, () => NOW)).toEqual({ userId: "42", accessToken: "ACCESS" });
    expect(credentialsFromToken({ ...base, expiresAt: NOW - 1 }, () => NOW)).toBeNull();
    expect(credentialsFromToken(null)).toBeNull();
    expect(credentialsFromToken({ discordId: "1" })).toBeNull();
  });
});

describe("safeCallbackUrl", () => {
  it.each([
    ["/g/1?a=b", "/g/1?a=b"],
    ["//evil.com", "/"],
    ["/\\evil.com", "/"],
    ["https://evil.com", "/"],
    ["javascript:alert(1)", "/"],
    ["/ok\nx", "/"],
    [undefined, "/"],
    [["/a"], "/"],
  ])("%s", (inp, out) => {
    expect(safeCallbackUrl(inp)).toBe(out);
  });
});

describe("proxy cookie", () => {
  it("reconhece cookies de sessao do Auth.js (inclusive chunked)", () => {
    expect(hasSessionCookie(["authjs.session-token"])).toBe(true);
    expect(hasSessionCookie(["__Secure-authjs.session-token.0"])).toBe(true);
    expect(hasSessionCookie(["authjs.csrf-token", "theme"])).toBe(false);
    expect(hasSessionCookie(["x-authjs.session-token"])).toBe(false);
  });
});