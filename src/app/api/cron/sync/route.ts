import { NextRequest, NextResponse } from 'next/server'
import { runDueSchedules } from '@/lib/sync/engine'
import { limparUsageEventsAntigos } from '@/lib/usage/cleanup'

/**
 * Endpoint chamado pelo Agendador de Tarefas do Windows (ou outro cron):
 *   curl -H "x-cron-secret: $CRON_SECRET" http://localhost:3002/api/cron/sync
 * Executa todas as agendas de sincronização vencidas.
 *
 * Gatilho reconfigurado para 1 em 1 minuto (pedido do usuário 2026-09-21,
 * era 5 em 5 min) — necessário para o retry rápido de erro parcial do
 * Omnilink (≈1 min, ver src/lib/sync/retry-policy.ts) rodar de fato a cada
 * 1 min, e não só na próxima janela do cron externo. Cada dataset continua
 * só rodando quando o próprio `nextRunAt` vence — chamar este endpoint mais
 * vezes não sincroniza nada fora de hora, só reduz a latência de "vencido,
 * mas ainda não percebido".
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
