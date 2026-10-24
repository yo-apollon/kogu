import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LoginButton } from "./login-button";

describe("LoginButton", () => {
  it("renderiza desabilitado ate a fase de auth", () => {
    render(<LoginButton />);
    const btn = screen.getByRole("button", { name: "Entrar com Discord" });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });
});