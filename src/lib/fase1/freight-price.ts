import { prisma } from '@/lib/prisma'

export interface FreightRate {
  valor: number
  unidade: 'KM' | 'TONELADA' | 'MDC' | 'M3'
}

/**
 * Resolve o valor de referência de frete (R$ por KM/TONELADA/MDC/M3,
 * conforme cadastrado) vigente de uma rota numa data. Mesmo padrão de
 * `composition.ts`: registro com effectiveFrom NULL é o cadastro (vale desde
 * sempre); cada mudança vale a partir da sua data. Vence o registro mais
 * recente com effectiveFrom <= data da viagem — assim, comparações
 * consideram o preço vigente na data de cada viagem, não só o mais recente
 * cadastrado.
 */
export async function buildFreightPriceResolver(): Promise<
  (routeId: string | null | undefined, dateYmd: string) => FreightRate | null
> {
  const records = await prisma.routeFreightPrice.findMany({
    orderBy: [{ routeId: 'asc' }, { effectiveFrom: 'asc' }],
  })

  const byRoute = new Map<string, { from: string | null; rate: FreightRate }[]>()
  for (const r of records) {
    const list = byRoute.get(r.routeId) ?? []
    list.push({
      from: r.effectiveFrom ? r.effectiveFrom.toISOString().slice(0, 10) : null,
      rate: { valor: Number(r.valorReferencia), unidade: r.unidade },
    })
    byRoute.set(r.routeId, list)
  }
  for (const list of byRoute.values()) {
    list.sort((a, b) => (a.from ?? '').localeCompare(b.from ?? ''))
  }

  return (routeId, dateYmd) => {
    if (!routeId) return null
    const list = byRoute.get(routeId)
    if (!list || list.length === 0) return null
    let current: FreightRate | null = null
    for (const r of list) {
      if (r.from === null || r.from <= dateYmd) current = r.rate
      else break
    }
    return current
  }
}

/**
 * Quantidade da viagem na unidade do valor de referência da rota — nunca usa
 * o VALOR da nota fiscal (mistura frete + produto, não serve para medir
 * receita de frete).
 */
export function quantidadeNaUnidade(trip: Record<string, unknown>, unidade: FreightRate['unidade']): number {
  switch (unidade) {
    case 'KM':
      return Number(trip.KM_RODADO) || 0
    case 'M3':
      return Number(trip.M3_TOTAL) || 0
    case 'MDC':
      return Number(trip.QUANTIDADE) || 0
    case 'TONELADA':
    default:
      return (Number(trip.PESOLIQUIDO) || 0) / 1000
  }
}
