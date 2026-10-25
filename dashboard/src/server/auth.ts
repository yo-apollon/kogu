import "server-only";
import NextAuth, { type NextAuthConfig, type Session } from "next-auth";
import { getToken, type JWT } from "next-auth/jwt";
import Discord from "next-auth/providers/discord";
import { headers } from "next/headers";
import { z } from "zod";
import { authEnv } from "@/lib/env";

export const DISCORD_TOKEN_URL = "https://discord.com/api/v10/oauth2/token";
export const SESSION_MAX_AGE_SEC = 7 * 24 * 60 * 60;
/** Renova/expira um pouco antes do vencimento real. */
const EXPIRY_SKEW_SEC = 60;

const nowSec = () => Math.floor(Date.now() / 1000);

const refreshResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().positive(),
});

export interface AuthDeps {
  fetch?: typeof fetch;
  nowSec?: () => number;
  clientId?: string;
  clientSecret?: string;
}

// Discord rotaciona o refresh_token a cada uso: chamadas simultaneas precisam compartilhar o resultado.
const refreshing = new Map<string, Promise<JWT | null>>();

async function refreshDiscordToken(token: JWT, deps: AuthDeps): Promise<JWT | null> {
  const refreshToken = token.refreshToken;
  if (!refreshToken) return null;
  const inflight = refreshing.get(refreshToken);
  if (inflight) return inflight;

  const run = (async () => {
    const env = deps.clientId && deps.clientSecret ? null : authEnv();
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: deps.clientId ?? env!.AUTH_DISCORD_ID,
      client_secret: deps.clientSecret ?? env!.AUTH_DISCORD_SECRET,
    });
    try {
      const res = await (deps.fetch ?? fetch)(DISCORD_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) return null;
      const parsed = refreshResponseSchema.safeParse(await res.json());
      if (!parsed.success) return null;
      return {
        ...token,
        accessToken: parsed.data.access_token,
        refreshToken: parsed.data.refresh_token ?? refreshToken,
        expiresAt: (deps.nowSec ?? nowSec)() + parsed.data.expires_in,
      } satisfies JWT;
    } catch {
      return null;
    }
  })();
  refreshing.set(refreshToken, run);
  run.then(
    () => setTimeout(() => refreshing.delete(refreshToken), 30_000).unref?.(),
    () => refreshing.delete(refreshToken)
  );
  return run;
}

interface DiscordProfileLike {
  id?: string;
  username?: string;
  global_name?: string | null;
  avatar?: string | null;
}

/**
 * Callback `jwt`. No login, grava identidade + tokens no JWE. Depois, devolve o token enquanto valido;
 * vencido: tenta refresh (se houver refresh_token) e, se nao der, devolve `null` (Auth.js limpa o
 * cookie e o usuario precisa logar de novo).
 *
 * LIMITE: em Server Components o Next nao deixa gravar cookies; o token renovado so persiste quando a
 * chamada passa por Route Handler / Server Action / `/api/auth/session`. Como o Discord rotaciona o
 * refresh_token, um refresh "perdido" simplesmente cai em novo login (falha segura).
 */
export async function jwtCallback(
  params: {
    token: JWT;
    account?: { providerAccountId?: string; access_token?: string; refresh_token?: string; expires_at?: number; expires_in?: number } | null;
    profile?: DiscordProfileLike | null;
  },
  deps: AuthDeps = {}
): Promise<JWT | null> {
  const { token, account, profile } = params;
  const now = (deps.nowSec ?? nowSec)();

  if (account?.access_token) {
    const discordId = account.providerAccountId ?? profile?.id;
    if (!discordId) return null;
    return {
      sub: discordId,
      discordId,
      name: profile?.global_name ?? profile?.username ?? null,
      avatar: profile?.avatar ?? null,
      accessToken: account.access_token,
      refreshToken: account.refresh_token,
      expiresAt: account.expires_at ?? (account.expires_in ? now + account.expires_in : now + 3600),
    };
  }

  if (!token.discordId || !token.accessToken || !token.expiresAt) return null;
  if (token.expiresAt - EXPIRY_SKEW_SEC > now) return token;
  return refreshDiscordToken(token, deps);
}

/** Callback `session`: so o necessario para a UI. Nunca inclui accessToken/refreshToken. */
export function sessionCallback({ session, token }: { session: Session; token: JWT }): Session {
  return {
    expires: session.expires,
    user: {
      id: token.discordId ?? "",
      name: token.name ?? "",
      avatar: token.avatar ?? null,
    },
  };
}

function secureCookies(): boolean {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "").startsWith("https://");
}

export function buildAuthConfig(): NextAuthConfig {
  const env = authEnv();
  return {
    secret: env.AUTH_SECRET,
    trustHost: env.AUTH_TRUST_HOST,
    useSecureCookies: secureCookies(),
    session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SEC },
    // Sem adapter: nada de usuario/conta/sessao no banco; o estado vive no JWE do cookie.
    providers: [
      Discord({
        clientId: env.AUTH_DISCORD_ID,
        clientSecret: env.AUTH_DISCORD_SECRET,
        authorization: { params: { scope: "identify guilds" } },
      }),
    ],
    pages: { signIn: "/login", error: "/login" },
    callbacks: {
      jwt: ({ token, account, profile }) =>
        jwtCallback({
          token,
          account,
          profile: profile as DiscordProfileLike | undefined,
        }),
      session: ({ session, token }) => sessionCallback({ session, token }),
    },
  };
}

// Configuracao preguicosa: o build nao exige segredos; eles so sao lidos por requisicao.
export const { handlers, auth, signIn, signOut } = NextAuth(() => buildAuthConfig());

export interface ServerCredentials {
  userId: string;
  accessToken: string;
}

/**
 * Le identidade + token OAuth direto do JWE do cookie (nunca passa pelo objeto `session`, que o
 * cliente pode ler em /api/auth/session). Devolve null se ausente, adulterado ou vencido.
 */
export async function getServerCredentials(): Promise<ServerCredentials | null> {
  const env = authEnv();
  const h = await headers();
  const token = await getToken({
    req: { headers: new Headers({ cookie: h.get("cookie") ?? "" }) },
    secret: env.AUTH_SECRET,
    secureCookie: secureCookies(),
  });
  return credentialsFromToken(token);
}

export function credentialsFromToken(
  token: JWT | null,
  now: () => number = nowSec
): ServerCredentials | null {
  if (!token?.discordId || !token.accessToken || !token.expiresAt) return null;
  if (token.expiresAt <= now()) return null;
  return { userId: token.discordId, accessToken: token.accessToken };
}
