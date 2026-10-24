import { LoginButton } from "@/components/login-button";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 px-4 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">Arqon</h1>
      <p className="text-[var(--muted)]">
        Acompanhe seu panteao, sua economia e administre seu servidor.
      </p>
      <LoginButton />
    </main>
  );
}