import { redirect } from 'next/navigation'
import { Prisma } from '@prisma/client'
import { getSessionUser, hasModuleAccess } from '@/lib/authz'
import { prisma } from '@/lib/prisma'
import { RastreamentoFrota } from '@/components/fase1/RastreamentoFrota'
import { getAllTripsEnriched } from '@/lib/fase1/get-trips-simple'
import { buildRouteMatcher } from '@/lib/fase1/route-match'
import { haversineKm } from '@/lib/geo'

export const dynamic = 'force-dynamic'

interface LatestPositionRow {
  placa: string
  latitude: number
  longitude: number
  speedKmh: number | null
  heading: number | null
  status: string | null
  localizacao: string | null
  capturedAt: Date
}

export default async function MapaPage() {
  const user = await getSessionUser()
  if (!hasModuleAccess(user, 'fase1')) redirect('/dashboard')

  // Local aparece no mapa se tiver ponto+raio OU polígono (pedido do
  // usuário 2026-07-30) cadastrado em Cadastros → Locais.
  const locations = await prisma.location.findMany({
    where: {
      active: true,
      OR: [{ latitude: { not: null }, longitude: { not: null } }, { polygon: { not: Prisma.JsonNull } }],
    },
    select: { id: true, name: true, type: true, latitude: true, longitude: true, raioMetros: true, polygon: true },
    orderBy: { name: 'asc' },
  })

  // Última posição por placa via DISTINCT ON — com histórico de até 60 dias
  // (retenção aplicada no post-process do sync), carregar tudo em memória só
  // para ficar com a mais recente deixou de fazer sentido depois que a
  // integração Omnilink passou a trazer volume real (pedido do usuário
  // 2026-08-03: "gerar mais uma aba com a última informação do rastreador").
  const latestPositions = await prisma.$queryRaw<LatestPositionRow[]>`
    SELECT DISTINCT ON (placa) placa, latitude, longitude, speed_kmh AS "speedKmh", heading, status, localizacao, captured_at AS "capturedAt"
    FROM vehicle_positions
    ORDER BY placa, captured_at DESC
  `

  // Indo (se aproximando do destino) vs voltando (se aproximando da origem) —
  // pedido do usuário 2026-08-03: "identificar caminhões indo e voltando de
  // acordo com a origem e o destino". Usa a viagem mais recente da placa (a
  // que está em curso) e compara a posição atual com as coordenadas de
  // origem/destino da rota cadastrada; sem rota com coordenadas, fica null
  // (mostrado só pelo status bruto do rastreador, sem essa classificação).
  const trips = await getAllTripsEnriched()
  const matchRoute = await buildRouteMatcher()
  const ultimaViagemPorPlaca = new Map<string, (typeof trips)[number]>()
  for (const trip of trips) {
    const placa = String(trip.PLACA ?? '').trim().toUpperCase()
    if (!placa) continue
    const atual = ultimaViagemPorPlaca.get(placa)
    if (!atual || String(trip.DATASAIDA ?? '') > String(atual.DATASAIDA ?? '')) ultimaViagemPorPlaca.set(placa, trip)
  }
  const sentidoPorPlaca = new Map<string, 'indo' | 'voltando'>()
  for (const pos of latestPositions) {
    const trip = ultimaViagemPorPlaca.get(pos.placa)
    const route = trip ? matchRoute(trip) : null
    if (!route?.originCoords || !route.destinationCoords) continue
    const atual = { lat: pos.latitude, lng: pos.longitude }
    const distDestino = haversineKm(atual, route.destinationCoords)
    const distOrigem = haversineKm(atual, route.originCoords)
    sentidoPorPlaca.set(pos.placa, distDestino < distOrigem ? 'indo' : 'voltando')
  }

  // Caminhão parado num Local conhecido (visita em aberto do motor de
  // geofence) — pedido do usuário 2026-08-03, caso real TBH2C02: aparecia
  // "voltando" já dentro da UPC Buriti Grande, o que é enganoso (não está
  // "voltando", já CHEGOU e está parado, possivelmente esperando carregar).
  // Quando há visita aberta, ela substitui o indo/voltando (que só faz
  // sentido em trânsito) por "no local: X, há Yh" — a duração já indica se
  // pode ser um atraso de carga/descarga.
  const localAtualPorPlaca = new Map<string, { nome: string; tipo: string; chegada: string }>()
  const visitasAbertas = await prisma.locationVisit.findMany({
    where: { saida: null },
    include: { location: { select: { name: true, type: true } } },
  })
  for (const v of visitasAbertas) {
    localAtualPorPlaca.set(v.placa, { nome: v.location.name, tipo: v.location.type, chegada: v.chegada.toISOString() })
  }

  // Adiantado/em dia/atrasado em relação ao retorno previsto (mesmos
  // parâmetros de velocidade/tempo de carga-descarga do painel principal) —
  // pedido do usuário 2026-08-03: "se está atrasado ou em dia em relação aos
  // parâmetros do sistema", ao lado do mapa.
  const agora = Date.now()
  const statusPorPlaca = new Map<string, 'EM_DIA' | 'ATRASADO' | 'MUITO_ATRASADO' | 'SEM_ROTA'>()
  for (const [placa, trip] of ultimaViagemPorPlaca.entries()) {
    const ret = trip.RETORNO_PREVISTO ? new Date(String(trip.RETORNO_PREVISTO)).getTime() : null
    const durMs = (Number(trip.DURACAO_HORAS) || 0) * 3_600_000
    if (ret === null) {
      statusPorPlaca.set(placa, 'SEM_ROTA')
    } else if (agora <= ret) {
      statusPorPlaca.set(placa, 'EM_DIA')
    } else if (agora <= ret + durMs) {
      statusPorPlaca.set(placa, 'ATRASADO')
    } else {
      statusPorPlaca.set(placa, 'MUITO_ATRASADO')
    }
  }

  // Velocidade média REAL da última viagem — pedido do usuário 2026-08-12: ao
  // clicar numa placa/composição no mapa, além de identificá-la, mostrar
  // dia da saída, previsão de retorno e velocidade média. Diferente da
  // velocidade padrão usada só para estimar o retorno (Parameter
  // VEL_CHEIO/VAZIO_PADRAO), aqui é a média das leituras reais do rastreador
  // (VehiclePosition.speedKmh) desde a saída da viagem até agora.
  const velocidadeMediaPorPlaca = new Map<string, number | null>()
  await Promise.all(
    [...ultimaViagemPorPlaca.entries()].map(async ([placa, trip]) => {
      const saida = trip.DATASAIDA ? new Date(String(trip.DATASAIDA)) : null
      if (!saida || Number.isNaN(saida.getTime())) {
        velocidadeMediaPorPlaca.set(placa, null)
        return
      }
      const agg = await prisma.vehiclePosition.aggregate({
        where: { placa, capturedAt: { gte: saida }, speedKmh: { not: null } },
        _avg: { speedKmh: true },
      })
      velocidadeMediaPorPlaca.set(placa, agg._avg.speedKmh != null ? Math.round(agg._avg.speedKmh) : null)
    }),
  )

  return (
    <RastreamentoFrota
      locations={locations.map((l) => ({
        id: l.id,
        name: l.name,
        type: l.type,
        latitude: l.latitude,
        longitude: l.longitude,
        raioMetros: l.raioMetros ?? 500,
        polygon: (l.polygon as { lat: number; lng: number }[] | null) ?? null,
      }))}
      positions={latestPositions.map((p) => {
        const localAtual = localAtualPorPlaca.get(p.placa) ?? null
        const trip = ultimaViagemPorPlaca.get(p.placa) ?? null
        return {
          placa: p.placa,
          latitude: p.latitude,
          longitude: p.longitude,
          speedKmh: p.speedKmh,
          heading: p.heading,
          status: p.status,
          localizacao: p.localizacao,
          capturedAt: p.capturedAt.toISOString(),
          // Parado num Local conhecido: indo/voltando não se aplica (a
          // distância à origem/destino ainda existiria, mas descreveria um
          // caminhão em trânsito, não um caminhão parado).
          sentido: localAtual ? null : (sentidoPorPlaca.get(p.placa) ?? null),
          statusViagem: statusPorPlaca.get(p.placa) ?? null,
          localAtual,
          ultimaViagem: trip
            ? {
                dataSaida: trip.DATASAIDA ? String(trip.DATASAIDA) : null,
                previsaoRetorno: trip.RETORNO_PREVISTO ? String(trip.RETORNO_PREVISTO) : null,
                velocidadeMediaKmh: velocidadeMediaPorPlaca.get(p.placa) ?? null,
              }
            : null,
        }
      })}
    />
  )
}
