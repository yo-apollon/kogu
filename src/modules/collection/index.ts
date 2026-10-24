/**
 * Modulo COLLECTION (Panteao): $pt, $im, $divorce, $firstmarry, $give, $note, $alias.
 *
 * - `commands`: comandos para o /help e o deploy dos slash.
 * - `registrations`: os mesmos comandos como `CommandRegistration`; o Panteao carrega o `matcher`
 *   dos atalhos com sufixo (`ptk=`, `ptw`...). Quem registra no `CommandRegistry` deve usar este
 *   array (ou `registerCommand` em cada item) para os atalhos funcionarem por prefixo.
 * - `components`: vazio (paginador e confirmacao sao roteados pelos namespaces globais pg/cf).
 */
import type { ComponentHandler } from "../../core/contracts.js";

export { commands, registrations } from "./commands.js";

export const components: ComponentHandler[] = [];
