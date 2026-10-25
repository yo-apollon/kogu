import { NextResponse, type NextRequest } from "next/server";

/**
 * Atalho de UX, NAO e autorizacao: manda para /login quem nem tem cookie de sessao nas rotas
 * protegidas. A checagem real (JWE valido, token do Discord, permissoes na guilda) acontece em
 * `src/server/authz.ts`, chamada no topo de cada page/layout/route/action.
 * Roda no runtime Node (padrao do Next 16 para proxy.ts).
 */
const SESSION_COOKIE_RE = /^(__Secure-)?authjs\.session-token(\.\d+)?$/;

export function hasSessionCookie(names: string[]): boolean {
  return names.some((n) => SESSION_COOKIE_RE.test(n));
}

export function proxy(request: NextRequest) {
  const names = request.cookies.getAll().map((c) => c.name);
  if (hasSessionCookie(names)) return NextResponse.next();

  const url = request.nextUrl.clone();
  const callbackUrl = request.nextUrl.pathname + request.nextUrl.search;
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("callbackUrl", callbackUrl);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/g/:path*", "/me/:path*", "/catalog/:path*", "/staff/:path*"],
};
