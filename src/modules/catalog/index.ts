import type { AnyCommand, ComponentHandler } from "../../core/contracts.js";
import { catalogCommands } from "./commands.js";
import { reviewHandler } from "./components.js";

/** Comandos do modulo CATALOG (import, suggest, suggestlist, approvesuggest, catalog). */
export const commands: AnyCommand[] = [...catalogCommands];

/** Componentes do painel `/catalog review` (namespace `cr`). */
export const components: ComponentHandler[] = [reviewHandler];
