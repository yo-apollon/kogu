import { vi } from "vitest";
import type {
  ButtonInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from "discord.js";
import type { KV, SetOptions } from "../../../src/infra/redis/kv.js";

/** KV minimo em memoria (apenas get/set/del/pexpire/pttl funcionam), com TTL por Date.now(). */
export class FakeKV implements KV {
  readonly kind = "memory" as const;
  readonly data = new Map<string, { value: string; expiresAt: number | null }>();
  readonly ttls = new Map<string, number>();

  async get(key: string): Promise<string | null> {
    const entry = this.data.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.data.delete(key);
      return null;
    }
    return entry.value;
  }
  async set(key: string, value: string, opts?: SetOptions): Promise<boolean> {
    if (opts?.nx && (await this.get(key)) !== null) return false;
    this.data.set(key, { value, expiresAt: opts?.px ? Date.now() + opts.px : null });
    if (opts?.px) this.ttls.set(key, opts.px);
    return true;
  }
  async del(...keys: string[]): Promise<number> {
    let n = 0;
    for (const k of keys) if (this.data.delete(k)) n++;
    return n;
  }
  async incr(): Promise<number> {
    throw new Error("not implemented");
  }
  async pexpire(): Promise<boolean> {
    return true;
  }
  async pttl(): Promise<number> {
    return -1;
  }
  async lpush(): Promise<number> {
    throw new Error("not implemented");
  }
  async ltrim(): Promise<void> {}
  async lrange(): Promise<string[]> {
    return [];
  }
  async publish(): Promise<void> {}
  async subscribe(): Promise<() => Promise<void>> {
    return async () => {};
  }
  async acquireLock(): Promise<string | null> {
    return "token";
  }
  async releaseLock(): Promise<boolean> {
    return true;
  }
  async takeToken(): Promise<number> {
    return 0;
  }
  async ping(): Promise<boolean> {
    return true;
  }
  async quit(): Promise<void> {}
}

function base(customId: string, userId: string) {
  return {
    customId,
    user: { id: userId },
    replied: false,
    deferred: false,
    message: { components: [] as unknown[] },
    reply: vi.fn(async () => undefined),
    update: vi.fn(async () => undefined),
    followUp: vi.fn(async () => undefined),
  };
}

export function mockButton(customId: string, userId: string) {
  const i = {
    ...base(customId, userId),
    isButton: () => true,
    isModalSubmit: () => false,
    showModal: vi.fn(async () => undefined),
  };
  return i as typeof i & ButtonInteraction;
}

export function mockModalSubmit(customId: string, userId: string, pageValue: string) {
  const i = {
    ...base(customId, userId),
    isButton: () => false,
    isModalSubmit: () => true,
    isFromMessage: () => true,
    fields: { getTextInputValue: vi.fn(() => pageValue) },
  };
  return i as typeof i & ModalSubmitInteraction;
}

export function mockSelect(customId: string, userId: string, values: string[]) {
  const i = {
    ...base(customId, userId),
    values,
    isButton: () => false,
    isModalSubmit: () => false,
  };
  return i as typeof i & StringSelectMenuInteraction;
}

/** Extrai os customIds/estado `disabled` das linhas de um payload. */
export function flattenComponents(rows: Array<{ toJSON(): any }>) {
  return rows.flatMap((row) => (row.toJSON().components as any[]) ?? []);
}
