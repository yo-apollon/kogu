import { z } from "zod";
import { childLogger } from "../../lib/logger.js";
import type { KV } from "./kv.js";

const log = childLogger("redis:pubsub");

/** Fonte unica da verdade: schema (validacao em runtime) e tipo (compilacao) de cada canal. */
export const channelSchemas = {
  "catalog:updated": z.object({
    /** Origem da atualizacao (ex.: "sync", "manual"). */
    source: z.string(),
    /** Epoch ms. */
    at: z.number(),
  }),
  "guild:config:invalidate": z.object({
    guildId: z.string(),
  }),
} as const;

export type ChannelName = keyof typeof channelSchemas;
export type ChannelPayload<C extends ChannelName> = z.infer<(typeof channelSchemas)[C]>;

export async function publishEvent<C extends ChannelName>(
  kv: KV,
  channel: C,
  payload: ChannelPayload<C>
): Promise<void> {
  const parsed = channelSchemas[channel].parse(payload);
  await kv.publish(channel, JSON.stringify(parsed));
}

/**
 * Assina um canal tipado. Mensagens invalidas (JSON ou schema) sao descartadas com aviso.
 * Retorna a funcao de cancelamento.
 */
export function subscribeEvent<C extends ChannelName>(
  kv: KV,
  channel: C,
  handler: (payload: ChannelPayload<C>) => void | Promise<void>
): Promise<() => Promise<void>> {
  return kv.subscribe(channel, (message) => {
    let json: unknown;
    try {
      json = JSON.parse(message);
    } catch {
      log.warn({ channel }, "mensagem de pubsub com JSON invalido descartada");
      return;
    }
    const parsed = channelSchemas[channel].safeParse(json);
    if (!parsed.success) {
      log.warn(
        { channel, issues: parsed.error.issues },
        "mensagem de pubsub fora do schema descartada"
      );
      return;
    }
    const payload = parsed.data as ChannelPayload<C>;
    // async IIFE captura tanto excecao sincrona quanto rejeicao do handler.
    void (async () => handler(payload))().catch((err: unknown) => {
      log.error({ err, channel }, "handler de evento lancou excecao");
    });
  });
}
