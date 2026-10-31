const fs = require('fs');
const postgres = require('postgres');

const sql = postgres('postgres://postgres:arqon_dev_pw@127.0.0.1:54329/arqon_dev');

async function main() {
  const rows = await sql`
    SELECT
      e.id::int AS id,
      e.name,
      s.title AS "seriesTitle",
      e.universe,
      e.gender,
      e.tier,
      e.base_aether AS "baseAether",
      e.popularity_rank AS "popularityRank",
      img.url AS "imageUrl"
    FROM entities e
    LEFT JOIN entity_series es ON es.entity_id = e.id AND es.is_primary = true
    LEFT JOIN series s ON s.id = es.series_id
    LEFT JOIN entity_images img ON img.entity_id = e.id AND img.is_primary = true
    WHERE e.status = 'ACTIVE'
    ORDER BY e.popularity_rank ASC NULLS LAST, e.base_aether DESC
    LIMIT 300
  `;
  fs.writeFileSync('/home/ubuntu/arqon/catalog_export.json', JSON.stringify(rows));
  console.log('Exported ' + rows.length + ' entities to catalog_export.json');
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
