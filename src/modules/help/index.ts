import type { AnyCommand, ComponentHandler } from "../../core/contracts.js";
import { helpCommands } from "./commands.js";

/** Comandos do modulo HELP (help). */
export const commands: AnyCommand[] = [...helpCommands];

/** O painel de ajuda usa o namespace global `pn` (src/ui/components/panel.ts); nada proprio aqui. */
export const components: ComponentHandler[] = [];
