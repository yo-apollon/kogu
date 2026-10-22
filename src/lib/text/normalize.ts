/** Marcas combinantes de diacriticos latinos/gregos/cirilicos (nao inclui dakuten/handakuten do kana). */
// eslint-disable-next-line no-misleading-character-class
const DIACRITICS =/[̀-ͯ᪰-᫿᷀-᷿⃐-⃿︠-︯]/g;

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
    .replace(/['’‘`´]/g, "") // apostrofos colam: o'brien -> obrien
    .replace(/[^\p{L}\p{N}\p{M}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Tokens do nome normalizado, ordenados ("Gojo Satoru" == "Satoru Gojo"). */
export function nameTokens(s: string): string[] {
  const n = normalizeName(s);
  return n === "" ? [] : n.split(" ").sort();
}

function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Slug estavel [a-z0-9-]. Nomes sem nenhum caractere latino/numerico (ex.: so CJK)
 * recebem `n-<hash>` para nao colidirem num slug vazio.
 */
export function slugify(s: string, maxLength = 80): string {
  const slug = s
    .normalize("NFKD")
    .replace(DIACRITICS, "")
    .toLowerCase()
    .replace(/['’‘`´]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
  if (slug !== "") return slug;
  const base = normalizeName(s);
  return base === "" ? "" : `n-${fnv1a(base)}`;
}

function trigrams(s: string): Set<string> {
  const set = new Set<string>();
  const words = normalizeName(s).split(" ").filter(Boolean);
  for (const word of words) {
    const chars = Array.from(`  ${word} `);
    for (let i = 0; i + 3 <= chars.length; i++) set.add(chars.slice(i, i + 3).join(""));
  }
  return set;
}

/**
 * Similaridade de trigramas no estilo pg_trgm: |A inter B| / |A uniao B|, entre 0 e 1.
 * Entradas passam por normalizeName (pg_trgm puro nao remove acentos).
 */
export function trigramSimilarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  return common / (ta.size + tb.size - common);
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body: string) => {
    if (body[0] === "#") {
      const code = body[1].toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 1 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return m;
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? m;
  });
}

/**
 * Converte HTML de descricoes (AniList/MAL) em texto puro: remove spoilers `~!...!~`
 * (spoiler sem fechamento corta ate o fim), scripts/estilos e tags, decodifica entidades basicas.
 */
export function stripHtml(s: string): string {
  return decodeEntities(
    s
      .replace(/~!.*?!~/gs, "")
      .replace(/~!.*$/s, "")
      .replace(/<(script|style)\b[^>]*>.*?<\/\1\s*>/gis, "")
      .replace(/<!--.*?-->/gs, "")
      .replace(/<br\s*\/?>|<\/p\s*>|<\/div\s*>/gi, "\n")
      .replace(/<[^>]*>/g, ""),
  )
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
