/**
 * Modulo ECONOMY (F10): timers, daily, perfil, reliquias e ranking do servidor.
 * O orquestrador registra `commands` e `components` em src/modules/index.ts.
 */
import type { AnyCommand, ComponentHandler } from "../../core/contracts.js";
import {
  badgevalueCommand,
  bronzeCommand,
  dailyCommand,
  economyComponent,
  emeraldCommand,
  goldCommand,
  kakeraUpCommand,
  kakerarewardCommand,
  marryUpCommand,
  profileCommand,
  relicsCommand,
  rollsUpCommand,
  rubyCommand,
  sapphireCommand,
  silverCommand,
  timersCommand,
  topCommand,
  topservkCommand,
  topservmCommand,
} from "./commands.js";

export const commands: AnyCommand[] = [
  timersCommand,
  marryUpCommand,
  rollsUpCommand,
  kakeraUpCommand,
  dailyCommand,
  profileCommand,
  relicsCommand,
  topCommand,
  bronzeCommand,
  silverCommand,
  goldCommand,
  sapphireCommand,
  rubyCommand,
  emeraldCommand,
  badgevalueCommand,
  kakerarewardCommand,
  topservkCommand,
  topservmCommand,
];

/** Namespace `ec` (botoes do altar de reliquias e do criterio do ranking). */
export const components: ComponentHandler[] = [economyComponent];
