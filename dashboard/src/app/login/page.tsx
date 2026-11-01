import { redirect } from "next/navigation";
import { LoginButton } from "@/components/login-button";
import { safeCallbackUrl } from "@/lib/safe-redirect";
import { auth, getServerCredentials } from "@/server/auth";

export const metadata = { title: "Entrar" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string | string[] }>;
}) {
  const sp = await searchParams;
  const callbackUrl = safeCallbackUrl(Array.isArray(sp.callbackUrl) ? sp.callbackUrl[0] : sp.callbackUrl);

  // So redireciona quem tem sessao E token do Discord validos (evita laco com cookie vencido).
  const [session, creds] = await Promise.all([auth(), getServerCredentials()]);
  if (session?.user?.id && creds?.userId === session.user.id) redirect(callbackUrl);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 px-4 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">Entrar no Kogu</h1>
      <p className="text-[var(--muted)]">
        Use sua conta do Discord para ver seu panteao e administrar seus servidores.
      </p>
      <LoginButton callbackUrl={callbackUrl} />
    </main>
  );
}