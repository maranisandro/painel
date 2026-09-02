import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, hasModuleAccess } from '@/lib/authz'
import { getDatasetView, getUltimaAtualizacao } from '@/lib/semantic/dataset-view'
import {
  prepararFuncionarios,
  linhasQuadroAtual,
  linhasDesligamentosPeriodo,
  linhasTransferenciasPeriodo,
  turnoverMensal,
} from '@/lib/rh/funcionarios'
import { hojeBrasil } from '@/lib/horario-brasil'

function monthStart(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

/**
 * Painel de RH: quadro atual (Ativo/Férias/Outros — sempre "foto de hoje",
 * nunca filtrado por período) + desligamentos/transferências no período
 * `from`/`to` (default mês atual, mesmo padrão de /api/fase3/data). A
 * agregação/cross-filtragem em si acontece no cliente sobre as linhas cruas.
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser()
  if (!hasModuleAccess(user, 'rh')) return NextResponse.json({ error: 'acesso negado' }, { status: 403 })

  const from = req.nextUrl.searchParams.get('from') || monthStart()
  const to = req.nextUrl.searchParams.get('to') || hojeBrasil()

  let view: Awaited<ReturnType<typeof getDatasetView>> = []
  try {
    view = await getDatasetView('rh_funcionarios')
  } catch {
    view = [] // dataset ainda não sincronizado
  }
  const rows = prepararFuncionarios(view)
  const ultimaAtualizacao = await getUltimaAtualizacao(['rh_funcionarios'])

  return NextResponse.json({
    period: { from, to },
    ultimaAtualizacao,
    quadroAtual: linhasQuadroAtual(rows),
    desligamentos: linhasDesligamentosPeriodo(rows, from, to),
    transferencias: linhasTransferenciasPeriodo(rows, from, to),
    // Turnover usa TODAS as linhas (histórico completo), não só o quadro
    // atual — calculado no servidor pra não precisar mandar as 50 mil linhas
    // pro cliente só por causa de 12 pontos de gráfico.
    turnoverMensal: turnoverMensal(rows, 12, to),
    semDados: rows.length === 0,
  })
}
