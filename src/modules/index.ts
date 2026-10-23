/**
 * Ponto unico de registro de modulos. Cada modulo (F10) exporta seus comandos/handlers e e
 * adicionado aqui. Hoje contem apenas o comando de exemplo `ping`.
 */
import type { AnyCommand, ComponentHandler } from "../core/contracts.js";
import { pingCommands } from "./ping/commands.js";

export const allCommands: AnyCommand[] = [...pingCommands];

export const allComponentHandlers: ComponentHandler[] = [];
