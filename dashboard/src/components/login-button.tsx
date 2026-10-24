import { cn } from "@/lib/cn";

export function LoginButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      disabled
      title="Disponivel apos a fase de autenticacao"
      className={cn(
        "rounded-md bg-[var(--accent)] px-5 py-2.5 font-medium text-[var(--accent-fg)] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    >
      Entrar com Discord
    </button>
  );
}