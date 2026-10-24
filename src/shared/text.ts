/**
 * Normalizacao de texto PURA (copiada para a dashboard). Fonte unica de `normalizeName`, `nameTokens`
 * e `escapeLike`; `src/lib/text/normalize.ts` e `modules/collection/service.ts` reexportam daqui.
 */

/** Marcas combinantes de diacriticos latinos/gregos/cirilicos (nao inclui dakuten/handakuten do kana). */
export const DIACRITICS =
  // eslint-disable-next-line no-misleading-character-class
  /[\u{300}-\u{36f}\u{1ab0}-\u{1aff}\u{1dc0}-\u{1dff}\u{20d0}-\u{20ff}\u{fe20}-\u{fe2f}]/gu;

/** Apostrofos (retos e tipograficos) e crases: colam o nome (o'brien -> obrien). */
export const APOSTROPHES = /['\u{2019}\u{2018}`\u{b4}]/gu;

/**
 * Normaliza um nome para comparacao: NFKD, remove diacriticos e pontuacao,
 * minusculas, colapsa espacos. Letras CJK/Hangul sao preservadas
 * (a composicao NFC apos remover diacriticos restaura kana com dakuten).
 */
export function normalizeName(s: string): string {
  return s
    .normalize("NFKD")
    .replace(DIACRITICS, "")
    .normalize("NFC")
    .toLowerCase()
    .replace(APOSTROPHES, "")
    .replace(/[^\p{L}\p{N}\p{M}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Tokens do nome normalizado, ordenados ("Gojo Satoru" == "Satoru Gojo"). */
export function nameTokens(s: string): string[] {
  const n = normalizeName(s);
  return n === "" ? [] : n.split(" ").sort();
}

/** Escapa `\`, `%` e `_` para uso em LIKE/ILIKE. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}