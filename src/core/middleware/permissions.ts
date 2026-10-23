/** Verifica `ownerOnly` (OWNER_IDS) e `permissions` (permissoes de Discord do membro). */
import { PermissionFlagsBits, PermissionsBitField } from "discord.js";
import { isOwner } from "../../config/env.js";
import { UserError } from "../../lib/errors.js";
import type { AnyCommand } from "../contracts.js";
import type { Middleware } from "../context.js";

function missingKey(required: bigint): string {
  if ((required & PermissionFlagsBits.Administrator) === PermissionFlagsBits.Administrator) {
    return "errors.missing_administrator";
  }
  if ((required & PermissionFlagsBits.ManageGuild) === PermissionFlagsBits.ManageGuild) {
    return "errors.missing_manage_guild";
  }
  return "common.no_permission";
}

export function checkCommandPermissions(
  command: AnyCommand,
  userId: string,
  member: { permissions: { has(p: bigint): boolean } } | null,
  ownerCheck: (id: string) => boolean = isOwner
): void {
  if (command.ownerOnly && !ownerCheck(userId)) {
    throw new UserError("errors.owner_only");
  }
  if (command.permissions !== undefined) {
    const required = PermissionsBitField.resolve(command.permissions);
    if (required !== 0n && !member?.permissions.has(required)) {
      throw new UserError(missingKey(required));
    }
  }
}

export function permissionsMiddleware(ownerCheck: (id: string) => boolean = isOwner): Middleware {
  return async (inv, next) => {
    checkCommandPermissions(inv.command, inv.user.id, inv.member, ownerCheck);
    await next();
  };
}
