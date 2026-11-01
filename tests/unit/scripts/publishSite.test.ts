import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildMeta, serializeCatalog, type SiteCard } from "../../../src/catalog/siteExport.js";
import { DEFAULT_POLICIES, normalizeRemote, publishSite, type RemotePolicy } from "../../../src/scripts/publishSite.js";

const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();

function card(over: Partial<SiteCard> = {}): SiteCard {
  return {
    id: 1,
    slug: "a",
    name: "A",
    seriesTitle: "S",
    universe: "ANIME",
    gender: "FEMALE",
    tier: "COMMON",
    baseAether: 100,
    popularityRank: 1,
    imageUrl: null,
    niche: null,
    nicheLabel: null,
    prestige: null,
    nicheRank: null,
    edition: null,
    parentSlug: null,
    stats: { atk: 1, def: 1, spd: 1, hp: 1 },
    supply: { max: null, label: null },
    aliases: [],
    art: { mode: "EMBLEM", emblem: "character" },
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

async function writeCatalog(repo: string, cards: SiteCard[]): Promise<void> {
  await fs.mkdir(path.join(repo, "docs"), { recursive: true });
  await fs.writeFile(path.join(repo, "docs", "catalog.json"), serializeCatalog(cards));
  await fs.writeFile(path.join(repo, "docs", "catalog.meta.json"), JSON.stringify(buildMeta(cards, new Date())));
}

let root: string;
let repo: string;
let bare: string;
let policies: RemotePolicy[];

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "site-pub-"));
  bare = path.join(root, "remote.git");
  repo = path.join(root, "work");
  await fs.mkdir(repo);
  execFileSync("git", ["init", "--bare", "-b", "main", bare]);
  execFileSync("git", ["init", "-b", "main", repo]);
  git(repo, "config", "user.email", "t@example.com");
  git(repo, "config", "user.name", "Teste");
  git(repo, "config", "commit.gpgsign", "false");
  git(repo, "remote", "add", "origin", bare);
  await writeCatalog(repo, [card()]);
  await fs.writeFile(path.join(repo, "docs", "index.html"), "<html></html>");
  await fs.writeFile(path.join(repo, "other.txt"), "x");
  git(repo, "add", "-A");
  git(repo, "commit", "-m", "base");
  git(repo, "push", "-u", "origin", "main");
  policies = [
    {
      remote: normalizeRemote(bare),
      catalogDir: "docs",
      files: ["docs/catalog.json", "docs/catalog.meta.json", "docs/index.html"],
    },
  ];
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("normalizeRemote", () => {
  it("normaliza formas https e ssh", () => {
    expect(normalizeRemote("https://github.com/yo-apollon/kogu.git")).toBe("github.com/yo-apollon/kogu");
    expect(normalizeRemote("git@github.com:Yo-Apollon/Kovu-Anime.git")).toBe("github.com/yo-apollon/kovu-anime");
    expect(normalizeRemote("https://user:tok@github.com/yo-apollon/kogu")).toBe("github.com/yo-apollon/kogu");
    expect(DEFAULT_POLICIES.map((p) => p.remote)).toEqual(["github.com/yo-apollon/kogu", "github.com/yo-apollon/kovu-anime"]);
  });
});

describe("publishSite", () => {
  it("sem mudancas: nada a publicar", async () => {
    const [r] = await publishSite({ repos: [repo], policies, yes: true });
    expect(r!.status).toBe("NOTHING_TO_PUBLISH");
  });

  it("dry-run por padrao: lista arquivos e nao commita", async () => {
    await writeCatalog(repo, [card({ baseAether: 200 })]);
    const head = git(repo, "rev-parse", "HEAD");
    const [r] = await publishSite({ repos: [repo], policies });
    expect(r!.status).toBe("DRY_RUN");
    expect(r!.files).toEqual(["docs/catalog.json", "docs/catalog.meta.json"]);
    expect(git(repo, "rev-parse", "HEAD")).toBe(head);
  });

  it("--yes: add so dos arquivos, commit e push", async () => {
    await writeCatalog(repo, [card({ baseAether: 200 })]);
    await fs.writeFile(path.join(repo, "untracked.txt"), "nao entra");
    const [r] = await publishSite({ repos: [repo], policies, yes: true });
    expect(r!.status).toBe("PUBLISHED");
    expect(r!.warnings.length).toBe(1);
    const names = git(repo, "show", "--name-only", "--format=", "HEAD").split("\n").sort();
    expect(names).toEqual(["docs/catalog.json", "docs/catalog.meta.json"]);
    expect(git(bare, "rev-parse", "main")).toBe(git(repo, "rev-parse", "HEAD"));
  });

  it("recusa remote nao permitido", async () => {
    await writeCatalog(repo, [card({ baseAether: 200 })]);
    const [r] = await publishSite({ repos: [repo], policies: DEFAULT_POLICIES, yes: true });
    expect(r!.status).toBe("REFUSED");
    expect(r!.reason).toMatch(/remote nao permitido/);
  });

  it("recusa mudanca rastreada nao relacionada", async () => {
    await writeCatalog(repo, [card({ baseAether: 200 })]);
    await fs.writeFile(path.join(repo, "other.txt"), "mudou");
    const head = git(repo, "rev-parse", "HEAD");
    const [r] = await publishSite({ repos: [repo], policies, yes: true });
    expect(r!.status).toBe("REFUSED");
    expect(r!.reason).toMatch(/nao relacionadas: other.txt/);
    expect(git(repo, "rev-parse", "HEAD")).toBe(head);
  });

  it("recusa quando ha algo staged", async () => {
    await writeCatalog(repo, [card({ baseAether: 200 })]);
    await fs.writeFile(path.join(repo, "other.txt"), "mudou");
    git(repo, "add", "other.txt");
    const [r] = await publishSite({ repos: [repo], policies, yes: true });
    expect(r!.status).toBe("REFUSED");
    expect(r!.reason).toMatch(/staged/);
  });

  it("recusa catalogo cujo hash nao bate com o meta", async () => {
    await writeCatalog(repo, [card({ baseAether: 200 })]);
    await fs.writeFile(path.join(repo, "docs", "catalog.json"), serializeCatalog([card({ baseAether: 999 })]));
    const [r] = await publishSite({ repos: [repo], policies, yes: true });
    expect(r!.status).toBe("REFUSED");
    expect(r!.reason).toMatch(/hash/);
  });

  it("recusa branch diferente de main/master e pasta que nao e repositorio", async () => {
    git(repo, "checkout", "-q", "-b", "feature");
    await writeCatalog(repo, [card({ baseAether: 200 })]);
    const [a] = await publishSite({ repos: [repo], policies, yes: true });
    expect(a!.reason).toMatch(/branch/);
    const plain = path.join(root, "plain");
    await fs.mkdir(plain);
    const [b] = await publishSite({ repos: [plain], policies, yes: true });
    expect(b!.status).toBe("REFUSED");
  });

  it("sem repositorios configurados lanca erro", async () => {
    await expect(publishSite({ repos: [] })).rejects.toThrow(/SITE_PUBLISH_REPOS/);
  });
});
