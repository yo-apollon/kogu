/**
 * Aplica data/art/overrides.json: define a arte oficial/curada como imagem primaria ACTIVE da entidade.
 *
 *   npm run catalog:art               # dry-run: valida e mostra o que faria (nao escreve)
 *   npm run catalog:art -- --apply    # grava em entity_images
 *   npm run catalog:art -- --file=outro.json
 *
 * Por override: valida o formato, o host (IMAGE_HOST_ALLOWLIST) e que a URL responde uma imagem
 * png/jpg/webp de tamanho razoavel (safeFetchImage); depois grava de forma idempotente.
 * A primaria anterior (se for outra URL) vira REMOVED: a verificacao periodica nunca a reativa.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { DbExecutor } from "../catalog/executor.js";
import { IMAGE_HOST_ALLOWLIST } from "../config/constants.js";
import { entities, entityImages } from "../infra/db/schema/index.js";
import { safeFetchImage, SafeFetchError, type FetchFn, type LookupFn } from "../lib/http/safeFetch.js";

export const OVERRIDES_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../data/art/overrides.json"
);

export const MIN_IMAGE_BYTES = 2 * 1024;
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"];

const overrideSchema = z.object({
  slug: z.string().min(1),
  url: z.string().url().max(2048),
  kind: z.enum(["CHARACTER", "ITEM"]),
  source: z.string().min(1),
  credit: z.string().optional(),
});

export type OverrideInput = z.infer<typeof overrideSchema>;

export type OverrideStatus =
  | "INVALID_FORMAT"
  | "HOST_NOT_ALLOWED"
  | "FETCH_FAILED"
  | "BAD_IMAGE"
  | "ENTITY_NOT_FOUND"
  | "UNCHANGED"
  | "WOULD_APPLY"
  | "APPLIED";

export interface OverrideResult {
  slug: string;
  url: string;
  status: OverrideStatus;
  detail?: string;
}

export interface ApplyOptions {
  apply?: boolean;
  allowHosts?: readonly string[];
  fetchImpl?: FetchFn;
  lookupImpl?: LookupFn;
  now?: Date;
}

/** Valida o formato do arquivo; devolve os itens validos e os invalidos (com o motivo). */
export function parseOverrides(raw: unknown): { valid: OverrideInput[]; invalid: OverrideResult[] } {
  if (!Array.isArray(raw)) {
    return { valid: [], invalid: [{ slug: "(arquivo)", url: "", status: "INVALID_FORMAT", detail: "esperado um array JSON" }] };
  }
  const valid: OverrideInput[] = [];
  const invalid: OverrideResult[] = [];
  for (const item of raw) {
    const r = overrideSchema.safeParse(item);
    if (r.success && r.data.url.startsWith("https://")) valid.push(r.data);
    else {
      const o = (item ?? {}) as Record<string, unknown>;
      invalid.push({
        slug: typeof o.slug === "string" ? o.slug : "(sem slug)",
        url: typeof o.url === "string" ? o.url : "",
        status: "INVALID_FORMAT",
        detail: r.success ? "a URL precisa ser https" : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      });
    }
  }
  return { valid, invalid };
}

function hostAllowed(url: string, allow: readonly string[]): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return allow.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

async function checkImage(o: OverrideInput, opts: ApplyOptions): Promise<OverrideResult | null> {
  const base = { slug: o.slug, url: o.url };
  const allow = opts.allowHosts ?? IMAGE_HOST_ALLOWLIST;
  if (!hostAllowed(o.url, allow)) {
    return { ...base, status: "HOST_NOT_ALLOWED", detail: "host fora de IMAGE_HOST_ALLOWLIST" };
  }
  try {
    const img = await safeFetchImage(o.url, {
      allowHosts: allow,
      maxBytes: MAX_IMAGE_BYTES,
      fetchImpl: opts.fetchImpl,
      lookupImpl: opts.lookupImpl,
    });
    if (!ACCEPTED_TYPES.includes(img.contentType)) {
      return { ...base, status: "BAD_IMAGE", detail: `tipo ${img.contentType} (aceito: png, jpg, webp)` };
    }
    if (img.buffer.length < MIN_IMAGE_BYTES) {
      return { ...base, status: "BAD_IMAGE", detail: `arquivo pequeno demais (${img.buffer.length} bytes)` };
    }
    return null;
  } catch (err) {
    const detail = err instanceof SafeFetchError ? `${err.code}: ${err.message}` : String(err);
    return { ...base, status: "FETCH_FAILED", detail };
  }
}

/** Valida cada override e, com `apply`, grava como imagem primaria ACTIVE. Idempotente. */
export async function applyArtOverrides(
  db: DbExecutor,
  rawOverrides: unknown,
  opts: ApplyOptions = {}
): Promise<OverrideResult[]> {
  const { valid, invalid } = parseOverrides(rawOverrides);
  const results: OverrideResult[] = [...invalid];
  const now = opts.now ?? new Date();

  for (const o of valid) {
    const bad = await checkImage(o, opts);
    if (bad) {
      results.push(bad);
      continue;
    }
    const outcome = await db.transaction(async (tx): Promise<OverrideResult> => {
      const base = { slug: o.slug, url: o.url };
      const [ent] = await tx.select({ id: entities.id }).from(entities).where(eq(entities.slug, o.slug)).limit(1);
      if (!ent) return { ...base, status: "ENTITY_NOT_FOUND" };

      const imgs = await tx
        .select({ id: entityImages.id, url: entityImages.url, isPrimary: entityImages.isPrimary, status: entityImages.status })
        .from(entityImages)
        .where(eq(entityImages.entityId, ent.id));
      const current = imgs.find((i) => i.isPrimary);
      if (current && current.url === o.url && current.status === "ACTIVE") return { ...base, status: "UNCHANGED" };
      if (!opts.apply) return { ...base, status: "WOULD_APPLY" };

      if (current) {
        await tx
          .update(entityImages)
          .set({ isPrimary: false, status: "REMOVED" })
          .where(eq(entityImages.id, current.id));
      }
      const same = imgs.find((i) => i.url === o.url && i.id !== current?.id);
      if (same) {
        await tx
          .update(entityImages)
          .set({ status: "ACTIVE", isPrimary: true, failCount: 0, lastVerifiedAt: now })
          .where(and(eq(entityImages.id, same.id)));
      } else if (current && current.url === o.url) {
        await tx
          .update(entityImages)
          .set({ status: "ACTIVE", isPrimary: true, failCount: 0, lastVerifiedAt: now })
          .where(eq(entityImages.id, current.id));
      } else {
        await tx.insert(entityImages).values({
          entityId: ent.id,
          url: o.url,
          source: "MANUAL",
          status: "ACTIVE",
          isPrimary: true,
          lastVerifiedAt: now,
        });
      }
      return { ...base, status: "APPLIED" };
    });
    results.push(outcome);
  }
  return results;
}

export function formatResults(results: readonly OverrideResult[], apply: boolean): string {
  if (results.length === 0) return "nenhum override em data/art/overrides.json";
  const counts = new Map<OverrideStatus, number>();
  const lines = results.map((r) => {
    counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
    return `${r.status.padEnd(17)} ${r.slug}${r.detail ? `  (${r.detail})` : ""}`;
  });
  const summary = [...counts].map(([s, n]) => `${s}=${n}`).join("  ");
  return [...lines, "", `${apply ? "APLICADO" : "DRY-RUN (use --apply para gravar)"}: ${summary}`].join("\n");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const fileArg = argv.find((a) => a.startsWith("--file="))?.slice("--file=".length);
  const file = fileArg ? path.resolve(fileArg) : OVERRIDES_PATH;
  const raw: unknown = JSON.parse(await fs.readFile(file, "utf8"));

  const { db, closeDb } = await import("../infra/db/client.js");
  try {
    const results = await applyArtOverrides(db as unknown as DbExecutor, raw, { apply });
    console.log(formatResults(results, apply));
    const failed = results.some((r) => ["INVALID_FORMAT", "HOST_NOT_ALLOWED", "FETCH_FAILED", "BAD_IMAGE"].includes(r.status));
    if (failed) process.exitCode = 1;
  } finally {
    await closeDb();
  }
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
