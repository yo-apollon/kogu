import { Queue, Worker, type ConnectionOptions, type Processor, type WorkerOptions } from "bullmq";
import { requireEnv } from "../../config/env.js";

/** Uma fila por fonte (concorrencia 1 cada) mais filas de manutencao. Nomes sem ":" (regra do BullMQ). */
export const QUEUE_NAMES = {
  anilist: "catalog-anilist",
  jikan: "catalog-jikan",
  igdb: "catalog-igdb",
  tmdb: "catalog-tmdb",
  maintenance: "catalog-maintenance",
  images: "catalog-images",
} as const;

export type QueueKey = keyof typeof QUEUE_NAMES;
export const QUEUE_PREFIX = "arqon";

/** Opcoes de conexao do BullMQ a partir da REDIS_URL (BullMQ exige maxRetriesPerRequest: null). */
export function bullConnection(url: string = requireEnv("REDIS_URL")): ConnectionOptions {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
    ...(u.username ? { username: decodeURIComponent(u.username) } : {}),
    ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
    ...(u.pathname.length > 1 ? { db: Number(u.pathname.slice(1)) } : {}),
    ...(u.protocol === "rediss:" ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  };
}

const queues = new Map<QueueKey, Queue>();

export function getQueue(key: QueueKey): Queue {
  let q = queues.get(key);
  if (!q) {
    q = new Queue(QUEUE_NAMES[key], { connection: bullConnection(), prefix: QUEUE_PREFIX });
    queues.set(key, q);
  }
  return q;
}

/** Worker com concorrencia 1 (jobs da mesma fonte nunca rodam em paralelo). */
export function createQueueWorker(
  key: QueueKey,
  processor: Processor,
  opts: Partial<WorkerOptions> = {}
): Worker {
  return new Worker(QUEUE_NAMES[key], processor, {
    connection: bullConnection(),
    prefix: QUEUE_PREFIX,
    concurrency: 1,
    ...opts,
  });
}

export async function closeQueues(): Promise<void> {
  const all = [...queues.values()];
  queues.clear();
  await Promise.all(all.map((q) => q.close().catch(() => undefined)));
}
