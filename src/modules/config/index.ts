import type { AnyCommand, ComponentHandler } from "../../core/contracts.js";
import { configCommands } from "./commands.js";

/** Comandos do modulo (registrados em src/modules/index.ts pelo orquestrador). */
export const commands: AnyCommand[] = [...configCommands];

/** Painel e paginacao usam os namespaces globais `pn` e `pg`; o modulo nao tem componentes proprios. */
export const components: ComponentHandler[] = [];
