import { db } from "../database/index.js";
import { entities } from "../database/schema.js";
import { eq } from "drizzle-orm";
import crypto from "crypto";

async function fetchTopAnilistCharacters(page: number) {
  const query = `
    query ($page: Int) {
      Page(page: $page, perPage: 50) {
        characters(sort: FAVOURITES_DESC) {
          id
          name { full native }
          image { large }
          gender
          favourites
          description
          media(sort: POPULARITY_DESC, perPage: 1) {
            nodes {
              title { english romaji }
              type
            }
          }
        }
      }
    }
  `;

  const res = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables: { page } }),
  });

  if (!res.ok) {
    throw new Error(`AniList API responded with status ${res.status}`);
  }

  const json: any = await res.json();
  return json?.data?.Page?.characters || [];
}

async function runMassSeed() {
  console.log("🌌 Iniciando Importação Massiva do Top Global do AniList (Páginas 1 a 6 = 300 Personagens)...");
  let totalInserted = 0;

  for (let page = 1; page <= 6; page++) {
    console.log(`📡 Buscando Página ${page}/6 do AniList...`);
    const characters = await fetchTopAnilistCharacters(page);

    for (const char of characters) {
      const fullName = char.name?.full;
      if (!fullName || !char.image?.large) continue;

      const slug = fullName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const mediaNode = char.media?.nodes?.[0];
      const franchise = mediaNode?.title?.english || mediaNode?.title?.romaji || "Universo Anime";
      const universe = mediaNode?.type === "MANGA" ? "ANIME" : "ANIME";

      let gender: "FEMALE" | "MALE" | "BOTH" = "FEMALE";
      if (char.gender === "Male") gender = "MALE";
      else if (char.gender === "Female") gender = "FEMALE";
      else {
        // Se a API não informar gênero, assume pelo contexto ou BOTH
        gender = Math.random() > 0.5 ? "FEMALE" : "MALE";
      }

      const favs = Number(char.favourites || 100);
      const calculatedAether = Math.min(1300, Math.max(150, Math.round(180 + Math.sqrt(favs) * 4.2)));

      const existing = await db.query.entities.findFirst({
        where: eq(entities.slug, slug),
      });

      const imagesArray = [char.image.large];

      if (existing) {
        db.update(entities)
          .set({
            name: fullName,
            originalName: char.name?.native || null,
            gender,
            universe,
            franchise,
            imagesJson: JSON.stringify(imagesArray),
            baseAether: calculatedAether,
          })
          .where(eq(entities.slug, slug))
          .run();
      } else {
        db.insert(entities)
          .values({
            id: crypto.randomUUID(),
            slug,
            name: fullName,
            originalName: char.name?.native || null,
            universe,
            type: "CHARACTER",
            gender,
            franchise,
            description: (char.description || "").replace(/<[^>]*>?/gm, "").slice(0, 240),
            imagesJson: JSON.stringify(imagesArray),
            baseAether: calculatedAether,
            popularityRank: totalInserted + 1,
            baseAtk: Math.min(99, 70 + Math.round(calculatedAether / 40)),
            baseDef: Math.min(99, 68 + Math.round(calculatedAether / 42)),
            baseSpd: Math.min(99, 72 + Math.round(calculatedAether / 38)),
            baseHp: 95,
          } as any)
          .run();
        totalInserted++;
      }
    }

    // Intervalo de segurança para não tomar rate limit da AniList
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }

  console.log(`✅ Catálogo expandido com sucesso! ${totalInserted} novas entidades cadastradas.`);
}

runMassSeed().catch(console.error);
