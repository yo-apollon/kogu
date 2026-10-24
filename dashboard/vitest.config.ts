import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const alias = {
  "@": fileURLToPath(new URL("./src", import.meta.url)),
  "server-only": fileURLToPath(new URL("./test/stubs/server-only.ts", import.meta.url)),
};

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: "components",
          environment: "jsdom",
          include: ["src/**/*.test.tsx", "test/components/**/*.test.tsx"],
          setupFiles: ["./test/setup-dom.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "server",
          environment: "node",
          include: ["src/**/*.test.ts", "test/server/**/*.test.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "int",
          environment: "node",
          include: ["test/int/**/*.test.ts"],
        },
      },
    ],
  },
});
