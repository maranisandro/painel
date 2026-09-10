import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, hasModuleAccess } from '@/lib/authz'
import { getDatasetView } from '@/lib/semantic/dataset-view'
import { prepararVendas, conferenciaDevolucoes } from '@/lib/fase3/faturamento'
import { resolverConfigVendas } from '@/lib/fase3/cotas'

function monthStart(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}
function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Fase 3 — Conferência de devoluções: pedido do usuário 2026-09-09 ("vamos
 * agrupar as notas para que possamos confirmar que o valor esta zerando e
 * quando os quantitativos e/ou valores forem diferentes podermos validar os
 * numeros"). Liga cada devolução à venda/bonificação de origem via
 * TMOV.IDMOVRELAC e devolve os grupos já separados em OK/divergente, mais as
 * devoluções sem origem encontrada no período.
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser()
  if (!hasModuleAccess(user, 'fase3')) return NextResponse.json({ error: 'acesso negado' }, { status: 403 })

  const from = req.nextUrl.searchParams.get('from') || monthStart()
  const to = req.nextUrl.searchParams.get('to') || todayStr()

  const config = await resolverConfigVendas()
  let linhas: ReturnType<typeof prepararVendas> = []
  try {
    const view = await getDatasetView('fase3_vendas_madeira_tratada')
    linhas = prepararVendas(view, from, to, config)
  } catch {
    linhas = []
  }

  const { grupos, semOrigem } = conferenciaDevolucoes(linhas)
  const gruposOk = grupos.filter((g) => g.ok)
  const gruposDivergentes = grupos.filter((g) => !g.ok)

  return NextResponse.json({
    period: { from, to },
    resumo: {
      gruposOk: gruposOk.length,
      gruposDivergentes: gruposDivergentes.length,
      semOrigem: semOrigem.length,
      valorSemOrigem: semOrigem.reduce((s, d) => s + d.valorBruto, 0),
    },
    grupos,
    semOrigem,
  })
}
