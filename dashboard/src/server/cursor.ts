import { z } from "zod";

/** Cursor keyset opaco: `{ v, id }` em JSON, base64url. `v` = valor de ordenacao, `id` = desempate. */
export const cursorSchema = z
  .object({
    v: z.union([z.string().max(200), z.number().finite()]),
    id: z.union([z.string().max(100), z.number().int()]),
  })
  .strict();

export type Cursor = z.infer<typeof cursorSchema>;

const MAX_ENCODED_LENGTH = 512;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

/** Cursor invalido ou adulterado: trate como 400/ignore e volte a primeira pagina. */
export class InvalidCursorError extends Error {
  constructor() {
    super("Cursor invalido");
    this.name = "InvalidCursorError";
  }
}

export function encodeCursor(cursor: Cursor): string {
  const parsed = cursorSchema.parse(cursor);
  return Buffer.from(JSON.stringify(parsed), "utf8").toString("base64url");
}

export function decodeCursor(raw: string): Cursor {
  if (raw.length === 0 || raw.length > MAX_ENCODED_LENGTH || !BASE64URL_RE.test(raw)) {
    throw new InvalidCursorError();
  }
  try {
    const json: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    const result = cursorSchema.safeParse(json);
    if (!result.success) throw new InvalidCursorError();
    return result.data;
  } catch {
    throw new InvalidCursorError();
  }
}

/** Conveniencia: `undefined`/vazio => null (primeira pagina); invalido => lanca InvalidCursorError. */
export function parseCursorParam(raw: string | null | undefined): Cursor | null {
  return raw ? decodeCursor(raw) : null;
}
