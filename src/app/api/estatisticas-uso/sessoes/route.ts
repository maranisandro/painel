import { NextRequest, NextResponse } from 'next/server'
import { requireResourceViewer } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

/**
 * Corte de sessão — pedido do usuário 2026-09-11: "preciso de detalhes das
 * sessões, quanto tempo o usuário ficou no sistema, o que ele acessou de
 * forma ativa". Sem gap explícito no evento (é derivado, não gravado), um
 * gap de 60min sem nenhum PAGE_VIEW/HEARTBEAT fecha a sessão atual — a
 * próxima atividade vira uma sessão nova. Decidido com o usuário (mais
 * tolerante que os 30min "padrão de mercado", pra não fragmentar em várias
 * sessões curtas por causa de uma pausa de almoço/reunião).
 */
const GAP_SESSAO_MS = 60 * 60 * 1000

interface EventoBruto {
  type: 'PAGE_VIEW' | 'HEARTBEAT'
  module: string
  path: string
  occurredAt: Date
}

interface SessaoModulo {
  module: string
  /** heartbeats × 30s — mesma estimativa de "minutos ativos" já usada no ranking de uso real */
  minutosAtivos: number
  paginas: string[]
}

interface Sessao {
  inicio: string
  fim: string
  duracaoMinutos: number
  modulos: SessaoModulo[]
}

function montarSessao(eventos: EventoBruto[]): Sessao {
  const inicio = eventos[0].occurredAt
  const fim = eventos[eventos.length - 1].occurredAt
  const porModulo = new Map<string, { heartbeats: number; paginas: Set<string> }>()
  for (const e of eventos) {
    const m = porModulo.get(e.module) ?? { heartbeats: 0, paginas: new Set<string>() }
    if (e.type === 'HEARTBEAT') m.heartbeats++
    if (e.type === 'PAGE_VIEW') m.paginas.add(e.path)
    porModulo.set(e.module, m)
  }
  const modulos = [...porModulo.entries()]
    .map(([module, v]) => ({ module, minutosAtivos: Math.round((v.heartbeats * 30) / 60), paginas: [...v.paginas] }))
    .sort((a, b) => b.minutosAtivos - a.minutosAtivos)
  return {
    inicio: inicio.toISOString(),
    fim: fim.toISOString(),
    duracaoMinutos: Math.round((fim.getTime() - inicio.getTime()) / 60000),
    modulos,
  }
}

/**
 * Detalhe de sessões de um usuário — pedido do usuário 2026-09-11: "detalhes
 * das sessões, quanto tempo o usuário ficou no sistema, o que ele acessou de
 * forma ativa, detalhes de cada sessão". Reconstrói sessões a partir de
 * `UsageEvent` (não há sessão gravada explicitamente) agrupando eventos
 * consecutivos do usuário com gap ≤ 60min; cada sessão detalha os módulos
 * visitados e o tempo ativo estimado em cada um.
 */
export async function GET(req: NextRequest) {
  const auth = await requireResourceViewer('estatisticas-uso')
  if ('error' in auth) return auth.error

  const { searchParams } = new URL(req.url)
  const userId = searchParams.get('userId')
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  if (!userId || !from || !to) return NextResponse.json({ error: 'userId/from/to obrigatórios' }, { status: 400 })
  const fromDate = new Date(`${from}T00:00:00`)
  const toDate = new Date(`${to}T23:59:59.999`)

  const eventos = await prisma.usageEvent.findMany({
    where: { userId, occurredAt: { gte: fromDate, lte: toDate } },
    orderBy: { occurredAt: 'asc' },
    select: { type: true, module: true, path: true, occurredAt: true },
  })

  const sessoes: Sessao[] = []
  let atual: EventoBruto[] = []
  for (const e of eventos) {
    if (atual.length > 0 && e.occurredAt.getTime() - atual[atual.length - 1].occurredAt.getTime() > GAP_SESSAO_MS) {
      sessoes.push(montarSessao(atual))
      atual = []
    }
    atual.push(e)
  }
  if (atual.length > 0) sessoes.push(montarSessao(atual))

  // Mais recente primeiro — mesmo critério de leitura das outras listas da tela.
  return NextResponse.json({ sessoes: sessoes.reverse() })
}
