import { NextResponse } from 'next/server'
import { getSessionUser, hasModuleAccess } from '@/lib/authz'
import { prisma } from '@/lib/prisma'
import { getDatasetView, getUltimaAtualizacao } from '@/lib/semantic/dataset-view'
import { buildCompositionResolver, composicoesAtuaisComDesde } from '@/lib/fase1/composition'
import { resolveParameter, calendarVarsFor } from '@/lib/semantic/parameters'

/**
 * Composições que pertencem ao Fase 5 — Transporte Interno de Madeira, e não
 * mais ao Fase 1 (Transporte Rodoviário). Mesma lista usada do lado do
 * Fase1Dashboard pra excluir essas placas de suas estatísticas — pedido do
 * usuário 2026-08-20: "o desenvolvimento do Tri-Trem Florestal vai entrar
 * como uma fase do projeto transporte de madeira e não como uma aba dentro
 * do transporte rodoviário".
 */
export const COMPOSICOES_FASE5 = new Set(['Tritrem Florestal'])

/**
 * Dados do painel Fase 5 — Transporte Interno de Madeira. Ainda sem dataset
 * de vendas de madeira (fase futura): só GPS (reaproveita o rastreamento já
 * sincronizado do Omnilink) e combustível (mesmo cálculo km/l do Fase1). Se
 * aparecer nota de transporte rodoviário pra alguma dessas placas, ela já é
 * sinalizada como crítica no Fase1 (achado "nota_apos_tritrem").
 */
export async function GET() {
  const user = await getSessionUser()
  if (!hasModuleAccess(user, 'fase5')) return NextResponse.json({ error: 'acesso negado' }, { status: 403 })

  const resolveComposition = await buildCompositionResolver()
  const composicoesAtuais = await composicoesAtuaisComDesde(resolveComposition)
  const placas = Object.entries(composicoesAtuais)
    .filter(([, info]) => COMPOSICOES_FASE5.has(info.composicao))
    .map(([placa, info]) => ({ placa, desde: info.desde }))

  const [allTrips, fuelRows, params] = await Promise.all([
    getDatasetView('fase1_vendas_transporte'),
    getDatasetView('fase1_abastecimento'),
    prisma.parameter.findMany({ select: { code: true, valueNumber: true, formula: true } }),
  ])

  const placasSet = new Set(placas.map((p) => p.placa))
  const abastecimento = fuelRows
    .filter((r) => placasSet.has(String(r.PLACA ?? '').trim().toUpperCase()))
    .map((r) => ({
      PLACA: String(r.PLACA ?? '').trim().toUpperCase(),
      date: String(r.date ?? '').slice(0, 10),
      pedometer: Number(r.pedometer) || 0,
      amount: Number(r.amount) || 0,
      produto: String(r.PRODUTO_ABASTECIMENTO ?? '').trim(),
    }))

  const paramsAsNumber = params.map((p) => ({ code: p.code, valueNumber: p.valueNumber ? Number(p.valueNumber) : null, formula: p.formula }))
  let metaConsumoKmL = 2
  try {
    metaConsumoKmL = resolveParameter('META_CONSUMO_KM_L', paramsAsNumber, calendarVarsFor(new Date()))
  } catch {
    metaConsumoKmL = 2
  }

  const ultimaAtualizacao = await getUltimaAtualizacao(['fase1_vendas_transporte', 'fase1_abastecimento'])

  return NextResponse.json({ placas, trips: allTrips, abastecimento, metaConsumoKmL, ultimaAtualizacao })
}
