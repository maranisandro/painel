import { prisma } from '@/lib/prisma'
import { getDatasetView } from '@/lib/semantic/dataset-view'
import { calendarVarsFor, resolveParameter } from '@/lib/semantic/parameters'
import { aggregateTrips, enrichTrips } from './trips'
import { buildRouteMatcher } from './route-match'
import { buildCompositionResolver, applyCompositionOverrides } from './composition'

type Row = Record<string, unknown>

/**
 * Versão enxuta de src/app/api/fase1/data/route.ts: só monta as viagens
 * agregadas (placa/data/peso/composição), sem KM/duração/conformidade/frete
 * — o suficiente para conciliar tickets de viagem (src/lib/ocr/ingest.ts).
 * Não depende de sessão/cookie, por isso pode ser chamada tanto pela rota de
 * upload (que tem um usuário logado) quanto pelo vigia de pasta em segundo
 * plano (que não tem — pedido do usuário 2026-08-03).
 */
export async function getAllTripsBasic(): Promise<Row[]> {
  const view = await getDatasetView('fase1_vendas_transporte')
  const matcher = await buildRouteMatcher()
  const resolveComposition = await buildCompositionResolver()
  const viewWithComposition = view.map((row) => {
    const c = resolveComposition(row.PLACA, String(row.DATASAIDA ?? '').slice(0, 10))
    return c ? { ...row, ['TipoComposição']: c } : row
  })
  return applyCompositionOverrides(aggregateTrips(viewWithComposition), matcher)
}

/**
 * Versão com KM_RODADO/DURACAO_HORAS/RETORNO_PREVISTO (mesmo enrichTrips do
 * painel principal) — usada no rastreamento (pedido do usuário 2026-08-03:
 * "se está adiantado ou atrasado com base nos parâmetros que descrevemos").
 * Não recalcula ritmo/meta de km (não depende de período filtrado), só a
 * expectativa de retorno de cada viagem.
 */
export async function getAllTripsEnriched(): Promise<Row[]> {
  const trips = await getAllTripsBasic()
  const matcher = await buildRouteMatcher()
  const paramRows = await prisma.parameter.findMany()
  const all = paramRows.map((p) => ({
    code: p.code,
    valueNumber: p.valueNumber ? Number(p.valueNumber) : null,
    formula: p.formula,
  }))
  const calendar = calendarVarsFor(new Date())
  function paramNumber(code: string, fallback: number): number {
    try {
      return resolveParameter(code, all, calendar)
    } catch {
      return fallback
    }
  }
  const defaults = {
    speedLoadedKmh: paramNumber('VEL_CHEIO_PADRAO', 60),
    speedEmptyKmh: paramNumber('VEL_VAZIO_PADRAO', 75),
    loadMinutes: paramNumber('TEMPO_CARGA_PADRAO', 90),
    unloadMinutes: paramNumber('TEMPO_DESCARGA_PADRAO', 90),
  }
  return enrichTrips(
    trips,
    (row) => {
      const route = matcher(row)
      return route
        ? {
            distanceKm: route.distanceKm,
            speedLoadedKmh: route.speedLoadedKmh,
            speedEmptyKmh: route.speedEmptyKmh,
            loadMinutes: route.loadMinutes,
            unloadMinutes: route.unloadMinutes,
            expectedRoundTripDays: route.expectedRoundTripDays,
          }
        : null
    },
    defaults,
  )
}
