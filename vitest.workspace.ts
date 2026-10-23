import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  {
    test: {
      name: "unit",
      include: ["tests/unit/**/*.test.ts"],
      environment: "node",
      // Os testes de tempo do canvas rodam junto com ~40 arquivos em paralelo; a medida
      // isolada (npx tsx src/scripts/testCanvas.ts --all) segue valendo o orcamento de 80 ms.
      env: { CANVAS_P95_BUDGET_MS: process.env.CANVAS_P95_BUDGET_MS ?? "150" },
    },
  },
  {
    test: {
      name: "integration",
      include: ["tests/integration/**/*.test.ts"],
      environment: "node",
      testTimeout: 30_000,
      hookTimeout: 30_000,
      pool: "forks",
      poolOptions: { forks: { singleFork: true } },
      // process.env e compartilhado entre arquivos no mesmo processo: sem isto, o dotenv de
      // config/env.ts injeta DATABASE_URL/REDIS_URL do .env local e os testes tentam um servidor
      // real inexistente em vez do embedded-postgres. Para usar servidores reais, defina
      // TEST_DATABASE_URL e TEST_REDIS_URL.
      env: {
        DATABASE_URL: "",
        REDIS_URL: process.env.TEST_REDIS_URL ?? "",
      },
    },
  },
]);
