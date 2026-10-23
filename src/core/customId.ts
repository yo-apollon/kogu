/**
 * Codec de customId: `<ns>:<parte>:<parte>...`.
 *
 * - Separador `:`; nenhuma parte (nem o namespace) pode conter `:`.
 * - Limite do Discord: 100 caracteres no total. `encodeCustomId` lanca se exceder
 *   (estado grande deve ficar no KV, referenciado por um id curto).
 * - `decodeCustomId` nunca lanca: devolve `null` para entradas invalidas.
 */

export const CUSTOM_ID_SEPARATOR = ":";
export const CUSTOM_ID_MAX_LENGTH = 100;

const NAMESPACE_RE = /^[A-Za-z0-9_-]+$/;

export type CustomIdPart = string | number | bigint;

export class CustomIdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomIdError";
  }
}

export interface DecodedCustomId {
  ns: string;
  parts: string[];
}

export function encodeCustomId(ns: string, ...parts: CustomIdPart[]): string {
  if (!NAMESPACE_RE.test(ns)) {
    throw new CustomIdError(`namespace de customId invalido: "${ns}"`);
  }
  const strings = parts.map((p) => String(p));
  for (const part of strings) {
    if (part.includes(CUSTOM_ID_SEPARATOR)) {
      throw new CustomIdError(`parte de customId nao pode conter "${CUSTOM_ID_SEPARATOR}"`);
    }
  }
  const id = [ns, ...strings].join(CUSTOM_ID_SEPARATOR);
  if (id.length > CUSTOM_ID_MAX_LENGTH) {
    throw new CustomIdError(
      `customId excede ${CUSTOM_ID_MAX_LENGTH} caracteres (${id.length}): "${id.slice(0, 30)}..."`
    );
  }
  return id;
}

export function decodeCustomId(customId: string): DecodedCustomId | null {
  if (typeof customId !== "string" || customId.length === 0) return null;
  if (customId.length > CUSTOM_ID_MAX_LENGTH) return null;
  const [ns, ...parts] = customId.split(CUSTOM_ID_SEPARATOR);
  if (ns === undefined || !NAMESPACE_RE.test(ns)) return null;
  return { ns, parts };
}
