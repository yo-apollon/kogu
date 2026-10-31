import postgres from "postgres";
import { TIER_WEIGHT } from "../config/gacha.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://postgres:arqon_dev_pw@127.0.0.1:54329/arqon_dev";

async function main() {
  const sql = postgres(DATABASE_URL);

  console.log("Rebalanceando ranks, tiers e pesos do catálogo...");

  const rows = await sql<{ id: number; base_aether: number; popularity_rank: number }[]>`
    SELECT id::int, base_aether::int, COALESCE(popularity_rank, 999999)::int AS popularity_rank
    FROM entities
    WHERE status = 'ACTIVE'
    ORDER BY base_aether DESC, popularity_rank ASC, id ASC
  `;

  const total = rows.length;
  console.log(`Total de entidades ativas para rebalancear: ${total}`);

  const mythicCut = Math.ceil(total * 0.01); // 1%
  const legCut = Math.ceil(total * 0.05);    // 5%
  const epicCut = Math.ceil(total * 0.15);   // 15%
  const rareCut = Math.ceil(total * 0.40);   // 40%

  console.log(`Cortes: MYTHIC 1..${mythicCut}, LEGENDARY ${mythicCut + 1}..${legCut}, EPIC ${legCut + 1}..${epicCut}, RARE ${epicCut + 1}..${rareCut}, COMMON ${rareCut + 1}..${total}`);

  await sql.begin(async (tx) => {
    for (let i = 0; i < total; i++) {
      const r = rows[i];
      const rank = i + 1;
      let tier: "MYTHIC" | "LEGENDARY" | "EPIC" | "RARE" | "COMMON" = "COMMON";
      if (rank <= mythicCut) tier = "MYTHIC";
      else if (rank <= legCut) tier = "LEGENDARY";
      else if (rank <= epicCut) tier = "EPIC";
      else if (rank <= rareCut) tier = "RARE";

      const score = Math.max(0, 1 - (rank - 1) / Math.max(1, total - 1));
      const rollWeight = Number((TIER_WEIGHT[tier] * (1 + 0.15 * score)).toFixed(4));

      await tx`
        UPDATE entities SET
          popularity_rank = ${rank},
          tier = ${tier},
          popularity_score = ${score},
          roll_weight = ${rollWeight},
          updated_at = now()
        WHERE id = ${r.id}
      `;
    }
  });

  const summary = await sql`
    SELECT tier, count(*)::int as count, min(base_aether) as min_aether, max(base_aether) as max_aether, round(avg(base_aether)) as avg_aether, round(avg(roll_weight)::numeric, 4) as avg_weight
    FROM entities
    WHERE status = 'ACTIVE'
    GROUP BY tier
    ORDER BY min_aether DESC
  `;

  console.log("\nResumo das Raridades Rebalanceadas:");
  console.table(summary);

  await sql.end();
}

main().catch((err) => {
  console.error("Erro no rebalanceamento:", err);
  process.exit(1);
});
