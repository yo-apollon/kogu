// Copia schema e modulos compartilhados do bot para src/generated/. Uso: node scripts/sync-shared.mjs [--check]
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const botRoot = resolve(root, "..");
const HEADER = "// GERADO por scripts/sync-shared.mjs â€” NÃƒO EDITE\n";
const check = process.argv.includes("--check");

const targets = [
  { from: join(botRoot, "src/infra/db/schema"), to: join(root, "src/generated/schema"), recursive: false },
  { from: join(botRoot, "src/shared"), to: join(root, "src/generated/shared"), recursive: true },
  // Dependencia de src/shared/pantheon.ts (constantes de gacha, sem imports proprios).
  { from: join(botRoot, "src/config"), to: join(root, "src/generated/config"), recursive: false, only: ["gacha.ts"] },
];

function listFiles(dir, recursive, only) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (recursive) out.push(...listFiles(full, true, only));
    } else if (name.endsWith(".ts") && (!only || only.includes(name))) {
      out.push(full);
    }
  }
  return out.sort();
}

function transform(source) {
  const body = source
    .replace(/\r\n/g, "\n")
    // No bot o schema vive em src/infra/db/schema; na dashboard fica em generated/schema.
    .replace(/(["'])((?:\.\.\/)+)infra\/db\/schema\//g, "$1../schema/")
    .replace(/(\bfrom\s+["'])(\.{1,2}\/[^"']*?)\.js(["'])/g, "$1$2$3");
  return HEADER + body;
}

/** Mapa caminho absoluto de destino -> conteudo esperado. */
function expected() {
  const map = new Map();
  for (const t of targets) {
    for (const file of listFiles(t.from, t.recursive, t.only)) {
      map.set(join(t.to, relative(t.from, file)), transform(readFileSync(file, "utf8")));
    }
  }
  return map;
}

function existing() {
  const set = new Set();
  for (const t of targets) for (const f of listFiles(t.to, true)) set.add(f);
  return set;
}

const want = expected();
const have = existing();
const drift = [];

for (const [path, content] of want) {
  if (!have.has(path) || readFileSync(path, "utf8") !== content) drift.push(path);
}
for (const path of have) if (!want.has(path)) drift.push(path);

if (check) {
  if (drift.length > 0) {
    console.error("Arquivos gerados desatualizados (rode `npm run sync:shared`):");
    for (const p of drift) console.error(`  ${relative(root, p)}`);
    process.exit(1);
  }
  console.log("sync-shared: ok");
} else {
  for (const p of have) if (!want.has(p)) rmSync(p);
  for (const [path, content] of want) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  console.log(`sync-shared: ${want.size} arquivo(s) gerado(s)`);
}