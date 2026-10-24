/**
 * Modulo ECONOMY (F10): timers, daily, perfil, reliquias e ranking do servidor.
 * O orquestrador registra `commands` e `components` em src/modules/index.ts.
 */
import type { AnyCommand, ComponentHandler } from "../../core/contracts.js";
import {
  dailyCommand,
  economyComponent,
  kakeraUpCommand,
  marryUpCommand,
  profileCommand,
  relicsCommand,
  rollsUpCommand,
  timersCommand,
  topCommand,
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
];

/** Namespace `ec` (botoes do altar de reliquias e do criterio do ranking). */
export const components: ComponentHandler[] = [economyComponent];
