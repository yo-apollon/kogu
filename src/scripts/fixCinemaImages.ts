/**
 * Atualiza as URLs das imagens de personagens de Cinema no PostgreSQL e SQLite
 * para que cada personagem tenha sua imagem icônica exclusiva (ex.: Darth Vader,
 * Luke Skywalker, Princesa Leia, Coringa, etc.), corrigindo o pôster genérico do Avatar.
 *
 * Execução:
 *   npx tsx src/scripts/fixCinemaImages.ts
 */
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

export const ENTITY_IMAGE_FIXES = [
  {
    name: "Darth Vader (Lorde das Cinzas)",
    imageUrl: "https://image.tmdb.org/t/p/w500/xfSAoBEm9MNBjmlNcDYLvLSMlnq.jpg",
  },
  {
    name: "Darth Vader (Lorde Sith)",
    imageUrl: "https://image.tmdb.org/t/p/w500/nNAeTmF4CtdSgMDplXTDPOpYzsX.jpg",
  },
  {
    name: "Luke Skywalker (Mestre Jedi)",
    imageUrl: "https://image.tmdb.org/t/p/w500/tEQlCGiiWvMvfD7Sz8d99Pouy39.jpg",
  },
  {
    name: "Princesa Leia Organa",
    imageUrl: "https://image.tmdb.org/t/p/w500/6FfCtAuVAW8XJjZ7eWeLibRLWTw.jpg",
  },
  {
    name: "Sabre de Luz de Anakin Skywalker",
    imageUrl: "https://image.tmdb.org/t/p/w500/xfSAoBEm9MNBjmlNcDYLvLSMlnq.jpg",
  },
  {
    name: "O Coringa (Joker)",
    imageUrl: "https://image.tmdb.org/t/p/w500/udDclJoHjfjb8Ekgsd4FDteOkCU.jpg",
  },
  {
    name: "Homem de Ferro (Iron Man)",
    imageUrl: "https://image.tmdb.org/t/p/w500/78lPtwv72eTNqFW9COBYI0dWDJa.jpg",
  },
  {
    name: "Thor Odinson (Deus do Trovão)",
    imageUrl: "https://image.tmdb.org/t/p/w500/prSfAi1xGrhLQNxVSUFh61xQ4Qy.jpg",
  },
  {
    name: "Feiticeira Escarlate (Scarlet Witch)",
    imageUrl: "https://image.tmdb.org/t/p/w500/ijWWwINc8h71NQ8j1LTJMFSj5wr.jpg",
  },
  {
    name: "Viúva Negra (Black Widow)",
    imageUrl: "https://image.tmdb.org/t/p/w500/kwB7d51AIcyzPOBOHLCEZJkmPhQ.jpg",
  },
];

async function main() {
  const databaseUrl =
    process.env.DATABASE_URL ?? "postgres://postgres:arqon_dev_pw@127.0.0.1:54329/arqon_dev";

  console.log(`🔌 Conectando ao banco Postgres em: ${databaseUrl.replace(/:[^:@]+@/, ":***@")}`);

  let sql: postgres.Sql | null = null;
  try {
    sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });

    for (const fix of ENTITY_IMAGE_FIXES) {
      const rows = await sql`SELECT id, name FROM entities WHERE name = ${fix.name}`;
      if (rows.length === 0) {
        console.log(`⚠️ Entidade não encontrada no Postgres: "${fix.name}"`);
        continue;
      }

      for (const entity of rows) {
        const entityId = Number(entity.id);

        // Atualiza imagem primária existente
        const updated = await sql`
          UPDATE entity_images
          SET url = ${fix.imageUrl}, status = 'ACTIVE'
          WHERE entity_id = ${entityId} AND is_primary = true
          RETURNING id
        `;

        if (updated.length > 0) {
          console.log(`✅ [PG] "${entity.name}" (ID ${entityId}): imagem atualizada para ${fix.imageUrl}`);
        } else {
          // Insere imagem primária se não havia nenhuma
          await sql`
            INSERT INTO entity_images (entity_id, url, source, status, is_primary)
            VALUES (${entityId}, ${fix.imageUrl}, 'MANUAL', 'ACTIVE', true)
          `;
          console.log(`✨ [PG] "${entity.name}" (ID ${entityId}): nova imagem primária inserida: ${fix.imageUrl}`);
        }
      }
    }
  } catch (err: any) {
    console.warn(`[Aviso Postgres] Não foi possível atualizar no Postgres local: ${err.message}`);
  } finally {
    if (sql) await sql.end();
  }

  // Se houver arqon_local.db SQLite, atualiza também
  const sqliteFile = path.resolve("arqon_local.db");
  if (fs.existsSync(sqliteFile)) {
    try {
      const Database = (await import("better-sqlite3")).default;
      const db = new Database(sqliteFile);
      const updateStmt = db.prepare("UPDATE entities SET image_url = ? WHERE name = ?");

      for (const fix of ENTITY_IMAGE_FIXES) {
        const res = updateStmt.run(fix.imageUrl, fix.name);
        if (res.changes > 0) {
          console.log(`✅ [SQLite] "${fix.name}": imagem atualizada`);
        }
      }
      db.close();
    } catch (err: any) {
      console.warn(`[Aviso SQLite] ${err.message}`);
    }
  }

  // Limpa cache de imagens em disco se existir
  const cacheDir = path.resolve(".cache/images");
  if (fs.existsSync(cacheDir)) {
    console.log("🧹 Limpando cache de imagens em disco...");
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }

  console.log("🎉 Correção de imagens do catálogo concluída com sucesso!");
}

main().catch((err) => {
  console.error("❌ Erro fatal:", err);
  process.exit(1);
});
