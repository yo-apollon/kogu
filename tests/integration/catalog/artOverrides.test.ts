import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDb, type TestDb } from "./testDb.js";
import { applyArtOverrides, MIN_IMAGE_BYTES, parseOverrides } from "../../../src/scripts/applyArtOverrides.js";

let t: TestDb;

const lookupImpl = async () => [{ address: "93.184.216.34" }];
const body = Buffer.alloc(MIN_IMAGE_BYTES + 100, 1);
const HOST = "upload.wikimedia.org";
const fetchImpl = async (url: string) => {
  if (url.includes("tiny")) return new Response(Buffer.alloc(10), { status: 200, headers: { "content-type": "image/png" } });
  if (url.includes("gif")) return new Response(body, { status: 200, headers: { "content-type": "image/gif" } });
  if (url.includes("html")) return new Response("<html>", { status: 200, headers: { "content-type": "text/html" } });
  if (url.includes("gone")) return new Response("nf", { status: 404 });
  return new Response(body, { status: 200, headers: { "content-type": url.endsWith(".webp") ? "image/webp" : "image/png" } });
};
const opts = { fetchImpl, lookupImpl };

async function entity(slug: string, imgs: Array<[string, boolean, string?]>): Promise<number> {
  const [e] = await t.sql`
    INSERT INTO entities (slug, name, name_normalized, universe, type, gender, status)
    VALUES (${slug}, ${slug}, ${slug}, 'GAME', 'WEAPON', 'UNKNOWN', 'ACTIVE') RETURNING id`;
  for (const [url, primary, status] of imgs) {
    await t.sql`
      INSERT INTO entity_images (entity_id, url, status, is_primary)
      VALUES (${e!.id}, ${url}, ${status ?? "ACTIVE"}, ${primary})`;
  }
  return e!.id as number;
}

const images = (id: number) =>
  t.sql`SELECT url, status, is_primary, source FROM entity_images WHERE entity_id = ${id} ORDER BY id`;

beforeAll(async () => {
  t = await startTestDb();
}, 120_000);

afterAll(async () => {
  await t?.stop();
}, 60_000);

describe("parseOverrides", () => {
  it("separa validos de invalidos", () => {
    const { valid, invalid } = parseOverrides([
      { slug: "a", url: `https://${HOST}/a.png`, kind: "ITEM", source: "wiki" },
      { slug: "b", url: "http://x.com/a.png", kind: "ITEM", source: "wiki" },
      { slug: "c", url: `https://${HOST}/c.png`, kind: "OUTRO", source: "wiki" },
      { url: `https://${HOST}/d.png` },
    ]);
    expect(valid.map((v) => v.slug)).toEqual(["a"]);
    expect(invalid).toHaveLength(3);
    expect(parseOverrides({}).invalid[0]!.status).toBe("INVALID_FORMAT");
  });
});

describe("applyArtOverrides", () => {
  it("dry-run valida e nao escreve", async () => {
    const id = await entity("dry-sword", [["https://s4.anilist.co/x.png", true]]);
    const r = await applyArtOverrides(
      t.db,
      [{ slug: "dry-sword", url: `https://${HOST}/sword.png`, kind: "ITEM", source: "wiki" }],
      { ...opts, apply: false }
    );
    expect(r[0]!.status).toBe("WOULD_APPLY");
    const rows = await images(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ url: "https://s4.anilist.co/x.png", is_primary: true });
  });

  it("apply: nova primaria ACTIVE, antiga REMOVED, e e idempotente", async () => {
    const id = await entity("axe", [["https://images.igdb.com/cover.png", true]]);
    const ov = [{ slug: "axe", url: `https://${HOST}/axe.png`, kind: "ITEM", source: "wiki", credit: "Autor" }];
    const r1 = await applyArtOverrides(t.db, ov, { ...opts, apply: true });
    expect(r1[0]!.status).toBe("APPLIED");
    const rows = await images(id);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ status: "REMOVED", is_primary: false });
    expect(rows[1]).toMatchObject({ url: `https://${HOST}/axe.png`, status: "ACTIVE", is_primary: true, source: "MANUAL" });

    const r2 = await applyArtOverrides(t.db, ov, { ...opts, apply: true });
    expect(r2[0]!.status).toBe("UNCHANGED");
    expect(await images(id)).toHaveLength(2);
  });

  it("reaproveita linha existente da mesma URL (secundaria ou REMOVED) como primaria", async () => {
    const url = `https://${HOST}/old.png`;
    const id = await entity("bow", [
      ["https://s4.anilist.co/b.png", true],
      [url, false, "REMOVED"],
    ]);
    const r = await applyArtOverrides(t.db, [{ slug: "bow", url, kind: "ITEM", source: "wiki" }], { ...opts, apply: true });
    expect(r[0]!.status).toBe("APPLIED");
    const rows = await images(id);
    expect(rows).toHaveLength(2);
    expect(rows.find((x) => x.url === url)).toMatchObject({ status: "ACTIVE", is_primary: true });
    expect(rows.find((x) => x.url !== url)).toMatchObject({ status: "REMOVED", is_primary: false });
  });

  it("entidade sem imagem recebe a primaria", async () => {
    const id = await entity("empty", []);
    const r = await applyArtOverrides(
      t.db,
      [{ slug: "empty", url: `https://${HOST}/e.webp`, kind: "CHARACTER", source: "wiki" }],
      { ...opts, apply: true }
    );
    expect(r[0]!.status).toBe("APPLIED");
    expect((await images(id))[0]).toMatchObject({ is_primary: true, status: "ACTIVE" });
  });

  it("rejeita host fora da allowlist, imagem pequena, tipo errado, 404 e slug inexistente (sem escrever)", async () => {
    const id = await entity("shield", [["https://s4.anilist.co/s.png", true]]);
    const mk = (slug: string, url: string) => ({ slug, url, kind: "ITEM", source: "wiki" });
    const r = await applyArtOverrides(
      t.db,
      [
        mk("shield", "https://evil.example.com/a.png"),
        mk("shield", `https://${HOST}/tiny.png`),
        mk("shield", `https://${HOST}/anim.gif`),
        mk("shield", `https://${HOST}/page.html`),
        mk("shield", `https://${HOST}/gone.png`),
        mk("nao-existe", `https://${HOST}/ok.png`),
      ],
      { ...opts, apply: true }
    );
    expect(r.map((x) => x.status)).toEqual([
      "HOST_NOT_ALLOWED",
      "BAD_IMAGE",
      "BAD_IMAGE",
      "FETCH_FAILED",
      "FETCH_FAILED",
      "ENTITY_NOT_FOUND",
    ]);
    const rows = await images(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ url: "https://s4.anilist.co/s.png", is_primary: true });
  });

  it("a restricao de uma primaria por entidade e preservada", async () => {
    const [{ n }] = await t.sql`
      SELECT max(c)::int AS n FROM (SELECT count(*) AS c FROM entity_images WHERE is_primary GROUP BY entity_id) s`;
    expect(n).toBe(1);
  });
});
