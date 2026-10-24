// Reaproveita o setup do embedded-postgres e os seeds do modulo catalog (mesmo padrao do summon).
export {
  seedEntity,
  seedGuild,
  seedMember,
  seedPact,
  seedUser,
  setupTestDb,
  uid,
  type TestDb,
} from "../catalog-module/helpers.js";
