import axe from "axe-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockMatchMedia, renderWithProviders } from "@/components/test-utils";
import { KitchenSink } from "./kitchen-sink";

vi.mock("next/navigation", () => ({
  usePathname: () => "/g/123/pantheon",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/components/charts/line-area-chart", () => ({
  LineAreaChart: ({ label }: { label: string }) => <div role="img" aria-label={label} />,
}));

describe("kitchen-sink (axe)", () => {
  beforeEach(() => mockMatchMedia(true));

  for (const theme of ["light", "dark"] as const) {
    it(`sem violacoes serias ou criticas (${theme})`, async () => {
      document.documentElement.dataset.theme = theme;
      const { container } = renderWithProviders(<KitchenSink />);
      const result = await axe.run(container, {
        // jsdom nao calcula layout/cores; contraste e checado em tokens.test.ts e no navegador.
        rules: { "color-contrast": { enabled: false }, region: { enabled: false } },
      });
      const serious = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
    });
  }
});
