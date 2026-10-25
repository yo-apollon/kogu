import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/login/actions", () => ({ signInWithDiscord: vi.fn() }));

import { LoginButton } from "./login-button";

describe("LoginButton", () => {
  it("renderiza botao de envio habilitado com callbackUrl oculto", () => {
    const { container } = render(<LoginButton callbackUrl="/g/1" />);
    const btn = screen.getByRole("button", { name: "Entrar com Discord" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.type).toBe("submit");
    expect(container.querySelector<HTMLInputElement>('input[name="callbackUrl"]')?.value).toBe("/g/1");
  });
});