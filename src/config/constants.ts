export const BOT_NAME = "Arqon";
export const EMBED_FOOTER = "Arqon RPG Dimensional";

/** Hosts permitidos para baixar imagens de cartas. */
export const IMAGE_HOST_ALLOWLIST = [
  "s4.anilist.co",
  "cdn.myanimelist.net",
  "images.igdb.com",
  "image.tmdb.org",
  "cdn.discordapp.com",
  "media.discordapp.net",
  "upload.wikimedia.org",
  "static.wikia.nocookie.net",
  "i.imgur.com",
  "imgur.com",
  "i.pinimg.com",
  "files.catbox.moe",
  "i.postimg.cc",
  "i.redd.it",
] as const;

export const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const IMAGE_FETCH_TIMEOUT_MS = 6000;
export const IMAGE_MAX_REDIRECTS = 2;
export const IMAGE_CONTENT_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

/** Idiomas suportados (codigo do locale -> alias aceito em $lang). */
export const SUPPORTED_LOCALES = ["pt-BR", "en-US"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "pt-BR";
