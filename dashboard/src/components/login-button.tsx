import { signInWithDiscord } from "@/app/login/actions";
import { cn } from "@/lib/cn";

export function LoginButton({ className, callbackUrl = "/" }: { className?: string; callbackUrl?: string }) {
  return (
    <form action={signInWithDiscord}>
      <input type="hidden" name="callbackUrl" value={callbackUrl} />
      <button
        type="submit"
        className={cn(
          "rounded-md bg-[var(--accent)] px-5 py-2.5 font-medium text-[var(--accent-fg)]",
          className,
        )}
      >
        Entrar com Discord
      </button>
    </form>
  );
}