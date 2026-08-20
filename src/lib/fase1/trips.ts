/**
 * Fase 1 — Transporte Rodoviário: transformação de movimentos em VIAGENS.
 *
 * Generalização da agregação do PowerQuery (pedido do usuário em 2026-07-24):
 * movimentos da MESMA DATA + PLACA + MOTORISTA + DESTINO são UMA viagem
 * física, juntando os números das notas fiscais (NUMEROMOV) com " / ".
 * Cobre tanto o RodoTrem (dois semirreboques = duas NFs) quanto qualquer
 * outra composição que emita mais de uma nota na mesma viagem.
 */

type Row = Record<string, unknown>

// Campos copiados do primeiro movimento do grupo para a viagem
const CARRY_FIELDS = [
  'CODCOLIGADA',
  'CODFILIAL',
  'DATASAIDA',
  'PLACA',
  'MOTORISTA',
  'NOMEFANTASIA',
  'NOME_FILIAL',
  'TransportadoraNome',
  'UPC',
  'TipoComposição',
  'Consolida Transportadora',
] as const

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function normKey(v: unknown): string {
  // remove espaços extras e ponto final (motoristas aparecem com e sem ".")
  return String(v ?? '').trim().toUpperCase().replace(/\.+$/, '')
}

function groupKey(row: Row): string {
  return [
    String(row.DATASAIDA ?? '').slice(0, 10),
    normKey(row.PLACA),
    normKey(row.MOTORISTA),
    normKey(row.NOMEFANTASIA),
  ].join('|')
}

function distinctJoin(rows: Row[], field: string): string {
  return [...new Set(rows.map((r) => String(r[field] ?? '').trim()).filter(Boolean))].join(' / ')
}

// Detalhe de cada nota fiscal que compõe a viagem (usado no detalhamento da
// conformidade de peso — a viagem soma/agrupa, mas o usuário pode conferir
// nota a nota).
function notaSummary(row: Row): Row {
  return {
    numeroMov: String(row.NUMEROMOV ?? ''),
    origem: String(row.UPC ?? row.NOME_FILIAL ?? ''),
    cliente: String(row.NOMEFANTASIA ?? ''),
    produto: String(row.PRODUTO ?? ''),
    pesoBruto: num(row.PESOBRUTO),
    pesoLiquido: num(row.PESOLIQUIDO),
    // Quantidade + unidade de medida (CODUND, ex.: MDC/M3/TON) — pedido do
    // usuário 2026-08-20: "na nota fiscal deve ter uma quantidade do item".
    // A unidade varia por NOTA, não só por produto (a mesma "Carvão" aparece
    // com CODUND "TON" ou "MDC" dependendo do lançamento), por isso fica
    // junto de cada nota em vez de assumida por produto.
    quantidade: num(row.QUANTIDADE),
    unidade: String(row.CODUND ?? '').trim().toUpperCase(),
  }
}

export function aggregateTrips(rawView: Row[]): Row[] {
  // Normaliza a placa (Oracle pode trazer espaços/caixa diferentes, o que
  // duplicaria o caminhão no agrupamento e nas telas)
  const view: Row[] = rawView.map((r) => ({
    ...r,
    PLACA: String(r.PLACA ?? '').trim().toUpperCase(),
  }))

  const groups = new Map<string, Row[]>()
  for (const row of view) {
    const key = groupKey(row)
    const list = groups.get(key)
    if (list) list.push(row)
    else groups.set(key, [row])
  }

  const trips: Row[] = []
  for (const [key, rows] of groups.entries()) {
    if (rows.length === 1) {
      trips.push({ ...rows[0], MOVIMENTOS: 1, NOTAS: [notaSummary(rows[0])], VIAGEM_KEY: key })
      continue
    }
    const first = rows[0]
    const trip: Row = { VIAGEM_KEY: key }
    for (const f of CARRY_FIELDS) trip[f] = first[f]
    // Notas fiscais da viagem juntas (mesma lógica do PowerQuery)
    trip.NUMEROMOV = distinctJoin(rows, 'NUMEROMOV')
    trip.CODTMV = distinctJoin(rows, 'CODTMV')
    trip.PRODUTO = distinctJoin(rows, 'PRODUTO')
    trip.TipoProduto = distinctJoin(rows, 'TipoProduto')
    trip.QUANTIDADE = rows.reduce((s, r) => s + num(r.QUANTIDADE), 0)
    trip.PESOLIQUIDO = rows.reduce((s, r) => s + num(r.PESOLIQUIDO), 0)
    trip.PESOBRUTO = rows.reduce((s, r) => s + num(r.PESOBRUTO), 0) / rows.length
    trip.M3_TOTAL = rows.reduce((s, r) => s + num(r.M3_TOTAL), 0)
    trip.VALOR_M3 = rows.reduce((s, r) => s + num(r.VALOR_M3), 0)
    trip.VALOR = rows.reduce((s, r) => s + num(r.VALOR), 0)
    trip.Distancia = rows.reduce((s, r) => s + num(r.Distancia), 0) / rows.length
    trip.MOVIMENTOS = rows.length
    trip.NOTAS = rows.map(notaSummary)
    trips.push(trip)
  }

  return trips
}

export interface TripDefaults {
  speedLoadedKmh: number
  speedEmptyKmh: number
  loadMinutes: number
  unloadMinutes: number
}

/**
 * Enriquece cada viagem com KM rodado (ida + volta) e expectativa de retorno,
 * usando os dados operacionais da rota (velocidades cheio/vazio e tempos de
 * carga/descarga) com fallback nos parâmetros padrão quando a rota ainda não
 * foi preenchida. Viagem sem rota cadastrada fica sem expectativa.
 */
export function enrichTrips(
  trips: Row[],
  matchRoute: (row: Row) => {
    distanceKm: number
    speedLoadedKmh: number | null
    speedEmptyKmh: number | null
    loadMinutes: number | null
    unloadMinutes: number | null
    expectedRoundTripDays: number | null
  } | null,
  defaults: TripDefaults,
): Row[] {
  return trips.map((trip) => {
    const route = matchRoute(trip)
    if (!route || route.distanceKm <= 0) {
      return { ...trip, KM_RODADO: 0, DURACAO_HORAS: null, RETORNO_PREVISTO: null }
    }
    // Expectativa em dias cadastrada na rota tem prioridade; sem ela, calcula
    // por velocidades cheio/vazio + tempos de carga/descarga (com padrões).
    let duracaoHoras: number
    if (route.expectedRoundTripDays && route.expectedRoundTripDays > 0) {
      duracaoHoras = route.expectedRoundTripDays * 24
    } else {
      const vCheio = route.speedLoadedKmh ?? defaults.speedLoadedKmh
      const vVazio = route.speedEmptyKmh ?? defaults.speedEmptyKmh
      const carga = route.loadMinutes ?? defaults.loadMinutes
      const descarga = route.unloadMinutes ?? defaults.unloadMinutes
      duracaoHoras =
        route.distanceKm / vCheio + route.distanceKm / vVazio + (carga + descarga) / 60
    }

    const saida = String(trip.DATASAIDA ?? '').slice(0, 10)
    let retornoPrevisto: string | null = null
    if (saida) {
      const dt = new Date(`${saida}T00:00:00`)
      dt.setMinutes(dt.getMinutes() + Math.round(duracaoHoras * 60))
      retornoPrevisto = dt.toISOString()
    }
    return {
      ...trip,
      KM_RODADO: route.distanceKm * 2,
      DURACAO_HORAS: Math.round(duracaoHoras * 10) / 10,
      RETORNO_PREVISTO: retornoPrevisto,
    }
  })
}
