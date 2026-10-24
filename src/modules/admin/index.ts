import type { AnyCommand, ComponentHandler } from "../../core/contracts.js";
import { adminCommands } from "./commands.js";

/** Comandos do modulo ADMIN (setvip, adminreset, cleanuser, thanos). */
export const commands: AnyCommand[] = [...adminCommands];

/** O modulo nao tem componentes proprios: a confirmacao usa o namespace global `cf` (src/ui). */
export const components: ComponentHandler[] = [];
