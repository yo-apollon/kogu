/**
 * Publicacao controlada do catalogo nos repositorios dos sites.
 *
 *   npm run site:publish              # dry-run (padrao): so mostra o que faria
 *   npm run site:publish -- --yes     # git add dos arquivos permitidos, commit e push
 *
 * Repositorios: SITE_PUBLISH_REPOS (caminhos separados por ';'). Por repositorio confere que o remote e
 * permitido, que nao ha nada staged, que nenhuma mudanca rastreada fora da lista permitida existe,
 * e que catalog.json bate com o hash do catalog.meta.json. Arquivos nao rastreados alheios sao ignorados
 * (nunca entram no commit, pois o add e por caminho). Nunca usa --force nem --no-verify.
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { hashCards, type SiteCard } from "../catalog/siteExport.js";

const execFileAsync = promisify(execFile);

export interface RemotePolicy {
  /** Remote normalizado: host/dono/repo, minusculo, sem .git (ex.: github.com/yo-apollon/kogu). */
  remote: string;
  /** Caminhos (relativos a raiz do repositorio, com `/`) que podem ser commitados. */
  files: string[];
  /** Subpasta do catalogo dentro do repositorio (onde estao catalog.json e catalog.meta.json). */
  catalogDir: string;
}

export const DEFAULT_POLICIES: readonly RemotePolicy[] = [
  {
    remote: "github.com/yo-apollon/kogu",
    catalogDir: "docs",
    files: ["docs/catalog.json", "docs/catalog.meta.json", "docs/index.html"],
  },
  {
    remote: "github.com/yo-apollon/kovu-anime",
    catalogDir: "public/assets/kogu",
    files: ["public/assets/kogu/catalog.json", "public/assets/kogu/catalog.meta.json", "public/kogu-bot.js"],
  },
];

export const COMMIT_MESSAGE = "Atualiza o catálogo do site a partir do bot";
const ALLOWED_BRANCHES = ["main", "master"];

export interface PublishOptions {
  repos: readonly string[];
  /** Sem `yes` e dry-run. */
  yes?: boolean;
  policies?: readonly RemotePolicy[];
  branches?: readonly string[];
}

export type PublishStatus = "PUBLISHED" | "DRY_RUN" | "NOTHING_TO_PUBLISH" | "REFUSED";

export interface PublishResult {
  repo: string;
  status: PublishStatus;
  files: string[];
  reason?: string;
  branch?: string;
  warnings: string[];
}

export function normalizeRemote(url: string): string {
  let u = url.trim();
  const scp = /^[^@/\s]+@([^:/\s]+):(.+)$/.exec(u); // git@github.com:dono/repo.git
  if (scp) u = `${scp[1]}/${scp[2]}`;
  u = u.replace(/^[a-z+]+:\/\//i, "").replace(/^[^@/]+@/, "");
  u = u.replace(/\/+$/, "").replace(/\.git$/i, "");
  return u.toLowerCase();
}

async function git(repo: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repo, ...args], { maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

interface StatusEntry {
  index: string;
  work: string;
  path: string;
}

function parseStatus(out: string): StatusEntry[] {
  const parts = out.split("\0").filter(Boolean);
  const entries: StatusEntry[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const index = p[0];
    const work = p[1];
    entries.push({ index, work, path: p.slice(3) });
    if (index === "R" || index === "C") i++; // o proximo item e o caminho de origem
  }
  return entries;
}

class Refusal extends Error {}

async function checkIntegrity(repo: string, policy: RemotePolicy): Promise<void> {
  const dir = path.join(repo, ...policy.catalogDir.split("/"));
  let cards: SiteCard[];
  let meta: { hash?: unknown };
  try {
    cards = JSON.parse(await fs.readFile(path.join(dir, "catalog.json"), "utf8")) as SiteCard[];
    meta = JSON.parse(await fs.readFile(path.join(dir, "catalog.meta.json"), "utf8")) as { hash?: unknown };
  } catch {
    throw new Refusal("catalog.json/catalog.meta.json ausentes ou invalidos");
  }
  if (!Array.isArray(cards) || cards.length === 0) throw new Refusal("catalog.json vazio ou nao e uma lista");
  if (typeof meta.hash !== "string" || meta.hash !== hashCards(cards)) {
    throw new Refusal("hash do catalog.meta.json nao bate com catalog.json (rode site:export de novo)");
  }
}

async function publishOne(repoPath: string, opts: PublishOptions): Promise<PublishResult> {
  const repo = path.resolve(repoPath);
  const result: PublishResult = { repo, status: "REFUSED", files: [], warnings: [] };
  try {
    let top: string;
    try {
      top = (await git(repo, ["rev-parse", "--show-toplevel"])).trim();
    } catch {
      throw new Refusal("nao e um repositorio git");
    }
    const [realTop, realRepo] = await Promise.all([fs.realpath(top), fs.realpath(repo)]);
    if (realTop.toLowerCase() !== realRepo.toLowerCase()) {
      throw new Refusal("o caminho nao e a raiz do repositorio git");
    }

    // Todos os remotes (fetch e push) precisam ser o mesmo e estar na lista permitida.
    const remotesOut = await git(repo, ["remote", "-v"]);
    const urls = [
      ...new Set(
        remotesOut
          .split(/\r?\n/)
          .filter(Boolean)
          .map((l) => normalizeRemote(l.split(/\s+/)[1] ?? ""))
      ),
    ];
    if (urls.length === 0) throw new Refusal("repositorio sem remote");
    if (urls.length !== 1) throw new Refusal(`mais de um remote distinto: ${urls.join(", ")}`);
    const policy = (opts.policies ?? DEFAULT_POLICIES).find((p) => p.remote === urls[0]);
    if (!policy) throw new Refusal(`remote nao permitido: ${urls[0]}`);

    const branch = (await git(repo, ["symbolic-ref", "--short", "-q", "HEAD"]).catch(() => "")).trim();
    if (!branch) throw new Refusal("HEAD solto (sem branch)");
    if (!(opts.branches ?? ALLOWED_BRANCHES).includes(branch)) throw new Refusal(`branch nao permitida: ${branch}`);
    result.branch = branch;

    const status = parseStatus(await git(repo, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]));
    const allowed = new Set(policy.files);
    const staged = status.filter((e) => e.index !== " " && e.index !== "?");
    if (staged.length > 0) throw new Refusal(`ha mudancas staged: ${staged.map((e) => e.path).join(", ")}`);
    const unrelated = status.filter((e) => e.index !== "?" && !allowed.has(e.path));
    if (unrelated.length > 0) {
      throw new Refusal(`mudancas nao relacionadas: ${unrelated.map((e) => e.path).join(", ")}`);
    }
    const untrackedOther = status.filter((e) => e.index === "?" && !allowed.has(e.path));
    if (untrackedOther.length > 0) {
      result.warnings.push(`${untrackedOther.length} arquivo(s) nao rastreado(s) ignorado(s)`);
    }

    const files = status
      .filter((e) => allowed.has(e.path))
      .map((e) => e.path)
      .sort();
    result.files = files;
    if (files.length === 0) {
      result.status = "NOTHING_TO_PUBLISH";
      return result;
    }
    // O catalogo so e verificado se ele mesmo vai no commit.
    if (files.some((f) => f.endsWith("catalog.json") || f.endsWith("catalog.meta.json"))) {
      await checkIntegrity(repo, policy);
    }

    if (!opts.yes) {
      result.status = "DRY_RUN";
      return result;
    }
    await git(repo, ["add", "--", ...files]);
    await git(repo, ["commit", "-m", COMMIT_MESSAGE]);
    await git(repo, ["push", "origin", branch]);
    result.status = "PUBLISHED";
    return result;
  } catch (err) {
    result.status = "REFUSED";
    result.reason = err instanceof Refusal ? err.message : `erro do git: ${(err as Error).message.split("\n")[0]}`;
    return result;
  }
}

/** Publica cada repositorio em sequencia; uma recusa nao impede os demais, mas e reportada. */
export async function publishSite(opts: PublishOptions): Promise<PublishResult[]> {
  if (opts.repos.length === 0) throw new Error("nenhum repositorio configurado (SITE_PUBLISH_REPOS)");
  const out: PublishResult[] = [];
  for (const r of opts.repos) out.push(await publishOne(r, opts));
  return out;
}

export function formatResults(results: readonly PublishResult[], yes: boolean): string {
  const lines: string[] = [];
  for (const r of results) {
    lines.push(`${r.status.padEnd(18)} ${r.repo}${r.branch ? ` [${r.branch}]` : ""}`);
    if (r.files.length > 0) lines.push(`  arquivos: ${r.files.join(", ")}`);
    if (r.reason) lines.push(`  motivo: ${r.reason}`);
    for (const w of r.warnings) lines.push(`  aviso: ${w}`);
  }
  if (!yes) lines.push("(dry-run: nada foi commitado nem enviado; use --yes para publicar)");
  return lines.join("\n");
}

async function main(): Promise<void> {
  const yes = process.argv.includes("--yes");
  const repos = (process.env.SITE_PUBLISH_REPOS ?? "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  const results = await publishSite({ repos, yes });
  console.log(formatResults(results, yes));
  if (results.some((r) => r.status === "REFUSED")) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
