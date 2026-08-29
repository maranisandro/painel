import { NextRequest, NextResponse } from 'next/server'
import { runDueSchedules } from '@/lib/sync/engine'
import { limparUsageEventsAntigos } from '@/lib/usage/cleanup'

/**
 * Endpoint chamado pelo Agendador de Tarefas do Windows (ou outro cron):
 *   curl -H "x-cron-secret: $CRON_SECRET" http://localhost:3002/api/cron/sync
 * Executa todas as agendas de sincronização vencidas.
 */
export async function GET(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret')
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'não autorizado' }, { status: 401 })
  }
  const results = await runDueSchedules()

  // Limpeza de eventos de uso antigos (S da retenção do módulo de
  // estatísticas) — só 1x/dia, piggyback neste mesmo cron de 5 em 5 min,
  // sem precisar de um crontab novo em produção.
  let usageEventsApagados: number | null = null
  if (new Date().getHours() === 3) {
    usageEventsApagados = await limparUsageEventsAntigos()
  }

  return NextResponse.json({ ran: results.length, results, usageEventsApagados })
}
