import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import postgres from "postgres";

/**
 * Sobe um embedded-postgres temporario (ou usa DATABASE_URL externa, ex.: servico do CI)
 * e entrega bancos novos e descartaveis. Nao importa src/config/env.ts de proposito.
 */
export interface PgHarness {
  createDatabase(prefix: string): Promise<{ name: string; url: string }>;
  stop(): Promise<void>;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

function withDatabase(url: string, dbName: string): string {
  const u = new URL(url);
  u.pathname = `/${dbName}`;
  return u.toString();
}

export async function startPostgres(): Promise<PgHarness> {
  const externalUrl = process.env.TEST_DATABASE_URL?.trim();
  let embedded: EmbeddedPostgres | undefined;
  let dataDir: string | undefined;
  let adminUrl: string;

  if (externalUrl) {
    adminUrl = externalUrl;
  } else {
    const port = await freePort();
    dataDir = await mkdtemp(path.join(os.tmpdir(), "arqon-pg-"));
    embedded = new EmbeddedPostgres({
      databaseDir: dataDir,
      user: "postgres",
      password: "arqon_test_pw",
      port,
      persistent: false,
      // No Windows o initdb herda WIN1252; nomes japoneses/acentuados exigem UTF8.
      initdbFlags: ["--encoding=UTF8", "--no-locale"],
      onLog: () => {},
      onError: () => {},
    });
    await embedded.initialise();
    await embedded.start();
    adminUrl = `postgres://postgres:arqon_test_pw@127.0.0.1:${port}/postgres`;
  }

  const created: string[] = [];

  return {
    async createDatabase(prefix) {
      const name = `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
      try {
        await admin.unsafe(`CREATE DATABASE "${name}"`);
      } finally {
        await admin.end({ timeout: 5 });
      }
      created.push(name);
      return { name, url: withDatabase(adminUrl, name) };
    },
    async stop() {
      if (created.length > 0) {
        const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
        for (const name of created) {
          try {
            await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
          } catch {}
        }
        await admin.end({ timeout: 5 }).catch(() => {});
      }
      if (embedded) {
        try {
          await embedded.stop();
        } catch {}
      }
      if (dataDir) {
        await rm(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(
          () => {}
        );
      }
    },
  };
}
