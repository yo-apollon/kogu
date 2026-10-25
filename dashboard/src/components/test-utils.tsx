import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { NuqsTestingAdapter, type OnUrlUpdateFunction } from "nuqs/adapters/testing";
import type { ReactElement } from "react";
import { vi } from "vitest";
import enUS from "../../messages/en-US.json";
import ptBR from "../../messages/pt-BR.json";

export const MESSAGES = { "pt-BR": ptBR, "en-US": enUS } as const;

/** jsdom nao tem matchMedia/ResizeObserver/scrollIntoView; os primitivos Radix precisam deles. */
export function installDomPolyfills(): void {
  if (!("ResizeObserver" in globalThis)) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
}

/** Simula `matchMedia`: `matches` fixo para qualquer consulta. */
export function mockMatchMedia(matches: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

export function renderWithProviders(
  ui: ReactElement,
  opts: { locale?: keyof typeof MESSAGES; searchParams?: string; onUrlUpdate?: OnUrlUpdateFunction } = {},
) {
  const { locale = "pt-BR", searchParams, onUrlUpdate } = opts;
  installDomPolyfills();
  return render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
      <NuqsTestingAdapter searchParams={searchParams} onUrlUpdate={onUrlUpdate}>
        {ui}
      </NuqsTestingAdapter>
    </NextIntlClientProvider>,
  );
}
