import { prisma } from '@/lib/prisma'

export interface MatchedRoute {
  id: string
  distanceKm: number
  speedLoadedKmh: number | null
  speedEmptyKmh: number | null
  loadMinutes: number | null
  unloadMinutes: number | null
  expectedRoundTripDays: number | null
  fixedComposition: string | null
  // Coordenadas de origem/destino — usadas para saber se o caminhão está
  // indo (se aproximando do destino) ou voltando (se aproximando da origem)
  // no rastreamento (pedido do usuário 2026-08-03).
  originCoords: { lat: number; lng: number } | null
  destinationCoords: { lat: number; lng: number } | null
}

type Row = Record<string, unknown>

/**
 * Carrega as rotas ativas e devolve um matcher que casa uma viagem
 * (coligada/filial + nome do cliente) com a rota cadastrada — mesma lógica
 * do LOOKUP de Distancia da camada semântica (origem mais específica vence).
 */
export async function buildRouteMatcher(): Promise<(row: Row) => MatchedRoute | null> {
  const routes = await prisma.route.findMany({
    where: { active: true },
    include: { origin: true, destination: true },
  })

  return (row: Row) => {
    const coligada = Number(row.CODCOLIGADA)
    const filial = Number(row.CODFILIAL)
    const cliente = String(row.NOMEFANTASIA ?? '').toUpperCase()
    let best: { specificity: number; route: (typeof routes)[number] } | null = null
    for (const route of routes) {
      const dest = route.destination
      const orig = route.origin
      if (!dest.matchClientePattern || !cliente.includes(dest.matchClientePattern.toUpperCase())) continue
      if (orig.matchColigada !== null && orig.matchColigada !== coligada) continue
      if (orig.matchFilial !== null && orig.matchFilial !== filial) continue
      const specificity = (orig.matchColigada !== null ? 1 : 0) + (orig.matchFilial !== null ? 1 : 0)
      if (!best || specificity > best.specificity) best = { specificity, route }
    }
    if (!best) return null
    const r = best.route
    return {
      id: r.id,
      distanceKm: Number(r.distanceAsphaltKm) + Number(r.distanceDirtKm),
      speedLoadedKmh: r.speedLoadedKmh ? Number(r.speedLoadedKmh) : null,
      speedEmptyKmh: r.speedEmptyKmh ? Number(r.speedEmptyKmh) : null,
      loadMinutes: r.loadMinutes,
      unloadMinutes: r.unloadMinutes,
      expectedRoundTripDays: r.expectedRoundTripDays ? Number(r.expectedRoundTripDays) : null,
      fixedComposition: r.fixedComposition,
      originCoords:
        r.origin.latitude != null && r.origin.longitude != null
          ? { lat: r.origin.latitude, lng: r.origin.longitude }
          : null,
      destinationCoords:
        r.destination.latitude != null && r.destination.longitude != null
          ? { lat: r.destination.latitude, lng: r.destination.longitude }
          : null,
    }
  }
}
