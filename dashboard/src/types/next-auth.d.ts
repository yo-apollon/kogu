import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  /** O que o cliente enxerga. Sem tokens: eles ficam so no JWE (cookie httpOnly). */
  interface Session {
    user: {
      id: string;
      name: string;
      /** Hash do avatar no CDN do Discord (nao a URL). */
      avatar: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    discordId?: string;
    name?: string | null;
    avatar?: string | null;
    /** Token OAuth do Discord (so servidor). */
    accessToken?: string;
    refreshToken?: string;
    /** Epoch em SEGUNDOS em que o accessToken expira. */
    expiresAt?: number;
  }
}
