/**
 * Ponto unico de registro de modulos. Cada modulo exporta `commands` e `components`;
 * o collection tambem exporta `registrations` (carrega o `matcher` dos atalhos com sufixo,
 * como `$ptk=`), que deve ser usado no lugar de `commands`.
 *
 * Importar este arquivo nao exige DATABASE_URL nem abre conexoes (o cliente do banco e
 * preguicoso), entao o script de deploy dos slash commands pode usa-lo.
 */
import type { AnyCommand, ComponentHandler } from "../core/contracts.js";
import type { CommandRegistration } from "../core/registry.js";
import { pingCommands } from "./ping/commands.js";
import * as admin from "./admin/index.js";
import * as catalog from "./catalog/index.js";
import * as collection from "./collection/index.js";
import * as config from "./config/index.js";
import * as economy from "./economy/index.js";
import * as help from "./help/index.js";
import * as summon from "./summon/index.js";
import * as wishlist from "./wishlist/index.js";

const wrap = (list: AnyCommand[]): CommandRegistration[] => list.map((cmd) => ({ cmd }));

/** Todos os comandos na forma aceita pelo CommandRegistry (com matchers quando existirem). */
export const allRegistrations: CommandRegistration[] = [
  ...wrap(pingCommands),
  ...wrap(summon.commands),
  ...collection.registrations,
  ...wrap(economy.commands),
  ...wrap(wishlist.commands),
  ...wrap(config.commands),
  ...wrap(catalog.commands),
  ...wrap(admin.commands),
  ...wrap(help.commands),
];

export const allCommands: AnyCommand[] = allRegistrations.map((r) => r.cmd);

export const allComponentHandlers: ComponentHandler[] = [
  ...summon.components,
  ...collection.components,
  ...economy.components,
  ...wishlist.components,
  ...config.components,
  ...catalog.components,
  ...admin.components,
  ...help.components,
];

/** Jobs de fundo do bot (iniciados depois do ClientReady). */
export const jobs = { startSummonSweeper: summon.jobs.startSummonSweeper };
