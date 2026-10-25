export interface ShellGuild {
  id: string;
  name: string;
  icon: string | null;
  canManage: boolean;
}

export interface ShellUser {
  name: string;
  handle?: string | null;
  avatar?: string | null;
}

export interface ShellStats {
  /** Saldo de Eter no servidor atual. */
  aether: number | bigint;
  rollsLeft: number;
  rollsMax?: number;
  /** Quando as invocacoes renovam. */
  rollsResetAt?: Date | number | string | null;
}
