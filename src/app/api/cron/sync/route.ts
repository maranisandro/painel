import { NextRequest, NextResponse } from 'next/server'
import { runDueSchedules } from '@/lib/sync/engine'
import { limparUsageEventsAntigos } from '@/lib/usage/cleanup'
import { executarBackfillOmnilink, type ResultadoBackfillOmnilink } from '@/lib/sync/omnilink-backfill'

// Backfill do histórico Omnilink roda no tempo que sobra desta execução do
// cron (1 em 1 min), depois das sincronizações vencidas — ver
// src/lib/sync/omnilink-backfill.ts. Teto de ~45s a partir do início da
// requisição para não empilhar com a próxima chamada do cron.
const TETO_EXECUCAO_BACKFILL_MS = 45_000

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
  const inicio = Date.now()
  const results = await runDueSchedules()

  // Limpeza de eventos de uso antigos (S da retenção do módulo de
  // estatísticas) — só 1x/dia, piggyback neste mesmo cron de 5 em 5 min,
  // sem precisar de um crontab novo em produção.
  let usageEventsApagados: number | null = null
  if (new Date().getHours() === 3) {
    usageEventsApagados = await limparUsageEventsAntigos()
  }

  let backfillOmnilink: ResultadoBackfillOmnilink | { erro: string }
  try {
    backfillOmnilink = await executarBackfillOmnilink(TETO_EXECUCAO_BACKFILL_MS - (Date.now() - inicio))
  } catch (err) {
    console.error('[omnilink-backfill] falha:', err)
    backfillOmnilink = { erro: err instanceof Error ? err.message : String(err) }
  }

  return NextResponse.json({ ran: results.length, results, usageEventsApagados, backfillOmnilink })
}
