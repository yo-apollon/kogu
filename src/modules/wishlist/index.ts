import type { AnyCommand, ComponentHandler } from "../../core/contracts.js";
import { wishlistCommands } from "./commands.js";

/** Comandos do modulo (registrados em src/modules/index.ts pelo orquestrador). */
export const commands: AnyCommand[] = [...wishlistCommands];

/** A paginacao usa o namespace global `pg`; o modulo nao tem componentes proprios. */
export const components: ComponentHandler[] = [];
