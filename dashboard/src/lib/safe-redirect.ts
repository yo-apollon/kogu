/** Aceita so caminhos relativos internos ("/x"), nunca "//host" nem "/\host" (open redirect). */
export function safeCallbackUrl(raw: unknown): string {
  if (typeof raw !== "string") return "/";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  if (/[\u0000-\u001f]/.test(raw)) return "/";
  return raw;
}