import crypto from "node:crypto";

/** Gera um identificador curto para correlacionar o erro mostrado ao usuario com o log. */
export function newErrorId(): string {
  return crypto.randomBytes(4).toString("hex");
}

/**
 * Erro esperado, com mensagem segura para o usuario.
 * `key` e a chave i18n; `params` os valores de substituicao.
 */
export class UserError extends Error {
  readonly key: string;
  readonly params: Record<string, string | number>;

  constructor(key: string, params: Record<string, string | number> = {}) {
    super(key);
    this.name = "UserError";
    this.key = key;
    this.params = params;
  }
}

/** Erro de infraestrutura (banco, redis, rede). Nunca exibe detalhes ao usuario. */
export class InfraError extends Error {
  readonly errorId = newErrorId();

  constructor(
    message: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = "InfraError";
  }
}

export function isUserError(err: unknown): err is UserError {
  return err instanceof UserError;
}
