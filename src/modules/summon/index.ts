/**
 * Modulo summon (F10): invocacao por prefixo e slash, botoes persistentes e sweeper de ofertas.
 * O orquestrador registra `commands`/`components` em src/modules/index.ts e liga
 * `jobs.startSummonSweeper(client, kv)` em src/index.ts (ver jobs.ts).
 */
import type { AnyCommand, ComponentHandler } from "../../core/contracts.js";
import { summonCommands } from "./commands.js";
import { summonComponentHandler } from "./components.js";
import { startSummonSweeper } from "./jobs.js";

export const commands: AnyCommand[] = [...summonCommands];
export const components: ComponentHandler[] = [summonComponentHandler];
export const jobs = { startSummonSweeper };
