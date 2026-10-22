import ModuleNs from "node:module";
import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";

dotenv.config();

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  throw new Error(
    "DATABASE_URL ausente. Defina no .env (veja .env.example) antes de usar o drizzle-kit."
  );
}

// O drizzle-kit 0.24 carrega o schema via require (CJS) e nao resolve imports "./x.js" para "./x.ts",
// mas o projeto (NodeNext) exige a extensao .js. Este hook so age quando o .js nao existe no disco.
// Patch em _findPath (e nao _resolveFilename) porque o kit restaura _resolveFilename a cada require.
const Module = ModuleNs as unknown as {
  _findPath: (this: unknown, request: string, ...rest: unknown[]) => string | false;
};
const originalFindPath = Module._findPath;
Module._findPath = function (this: unknown, request: string, ...rest: unknown[]) {
  const found = originalFindPath.call(this, request, ...rest);
  if (!found && request.startsWith(".") && request.endsWith(".js")) {
    return originalFindPath.call(this, request.slice(0, -3) + ".ts", ...rest);
  }
  return found;
};

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/infra/db/schema/index.ts",
  out: "./src/infra/db/migrations",
  dbCredentials: { url },
});
