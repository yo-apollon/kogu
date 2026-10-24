// Roda só os testes de orçamento de tempo do canvas, isolados e em um worker, para medir sem ruído.
import { spawnSync } from "node:child_process";

const result = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["vitest", "run", "--project", "unit", "tests/unit/canvas", "--poolOptions.threads.singleThread"],
  { stdio: "inherit", env: { ...process.env, CANVAS_PERF: "1" }, shell: process.platform === "win32" }
);
process.exit(result.status ?? 1);
