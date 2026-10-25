"use server";

import { safeCallbackUrl } from "@/lib/safe-redirect";
import { signIn } from "@/server/auth";

export async function signInWithDiscord(formData: FormData): Promise<void> {
  await signIn("discord", { redirectTo: safeCallbackUrl(formData.get("callbackUrl")) });
}