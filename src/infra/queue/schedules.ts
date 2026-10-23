import { getQueue, type QueueKey } from "./queues.js";

export interface ScheduleSpec {
  /** Id estavel do scheduler (normalmente o nome do job). */
  id: string;
  queue: QueueKey;
  jobName: string;
  /** Intervalo fixo em ms. */
  every?: number;
  /** Cron (UTC). */
  pattern?: string;
  data?: Record<string, unknown>;
}

/**
 * Registra (idempotente) os repeatable jobs e remove os schedulers que nao estao mais na tabela.
 * `attempts: 1`: o runner ja registra a falha em sync_runs; a proxima ocorrencia tenta de novo.
 */
export async function registerSchedules(specs: readonly ScheduleSpec[]): Promise<void> {
  const byQueue = new Map<QueueKey, Set<string>>();
  for (const s of specs) {
    if (s.every === undefined && s.pattern === undefined) {
      throw new Error(`schedule ${s.id} sem every nem pattern`);
    }
    const q = getQueue(s.queue);
    await q.upsertJobScheduler(
      s.id,
      s.every !== undefined ? { every: s.every } : { pattern: s.pattern!, tz: "UTC" },
      {
        name: s.jobName,
        data: s.data ?? {},
        opts: { attempts: 1, removeOnComplete: { count: 20 }, removeOnFail: { count: 50 } },
      }
    );
    let ids = byQueue.get(s.queue);
    if (!ids) byQueue.set(s.queue, (ids = new Set()));
    ids.add(s.id);
  }
  for (const [key, ids] of byQueue) {
    const q = getQueue(key);
    for (const sch of await q.getJobSchedulers()) {
      if (sch.key && !ids.has(sch.key)) await q.removeJobScheduler(sch.key);
    }
  }
}
