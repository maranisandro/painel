import { prisma } from '@/lib/prisma'

const RETENTION_DAYS = 180

/**
 * Apaga UsageEvent mais antigos que RETENTION_DAYS — chamado só quando a
 * hora atual é 3h (ver src/app/api/cron/sync/route.ts), pra rodar uma vez
 * por dia sem precisar de um crontab novo em produção (o cron de sync já
 * roda a cada 5 min).
 */
export async function limparUsageEventsAntigos(): Promise<number> {
  const corte = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000)
  const { count } = await prisma.usageEvent.deleteMany({ where: { occurredAt: { lt: corte } } })
  return count
}
