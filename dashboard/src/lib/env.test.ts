import { describe, expect, it } from "vitest";
import { parseServerEnv } from "./env";

const valid = {
  AUTH_SECRET: "x".repeat(32),
  AUTH_DISCORD_ID: "123",
  AUTH_DISCORD_SECRET: "secret",
  DATABASE_URL_RO: "postgres://ro@localhost:5432/arqon",
  DATABASE_URL_RW: "postgres://rw@localhost:5432/arqon",
  OWNER_IDS: "1, 2",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
};

describe("parseServerEnv", () => {
  it("aceita env valida e separa OWNER_IDS", () => {
    expect(parseServerEnv(valid).OWNER_IDS).toEqual(["1", "2"]);
  });

  it("rejeita env incompleta", () => {
    expect(() => parseServerEnv({ ...valid, AUTH_SECRET: undefined })).toThrow(/AUTH_SECRET/);
  });

  it("rejeita URL de banco invalida", () => {
    expect(() => parseServerEnv({ ...valid, DATABASE_URL_RW: "nope" })).toThrow(/DATABASE_URL_RW/);
  });
});