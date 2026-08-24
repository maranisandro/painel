'use client'

import { useEffect, useRef, useState } from 'react'
import { loadGoogleMaps } from '@/lib/google-maps'

type LocationTypeMarker = 'UNIDADE' | 'CLIENTE' | 'CIDADE' | 'POSTO_GASOLINA' | 'OFICINA' | 'RESIDENCIA'

interface LocationMarker {
  id: string
  name: string
  type: LocationTypeMarker
  /** null quando o local usa polígono em vez de ponto+raio */
  latitude: number | null
  longitude: number | null
  raioMetros: number
  /** desenhado no lugar do marcador de ponto quando presente (3+ vértices) */
  polygon: { lat: number; lng: number }[] | null
}

// Cores por tipo de local — pedido do usuário 2026-08-03 (novos tipos: cidade,
// posto, oficina, residência), além de UNIDADE/CLIENTE já existentes.
const LOCATION_COR: Record<LocationTypeMarker, string> = {
  UNIDADE: '#047857',
  CLIENTE: '#0891b2',
  CIDADE: '#64748b',
  POSTO_GASOLINA: '#ca8a04',
  OFICINA: '#7c3aed',
  RESIDENCIA: '#db2777',
}
const LOCATION_LABEL: Record<LocationTypeMarker, string> = {
  UNIDADE: 'Unidade do grupo',
  CLIENTE: 'Cliente',
  CIDADE: 'Cidade',
  POSTO_GASOLINA: 'Posto de gasolina',
  OFICINA: 'Oficina',
  RESIDENCIA: 'Residência',
}

interface VehiclePositionMarker {
  placa: string
  latitude: number
  longitude: number
  speedKmh: number | null
  heading: number | null
  status: string | null
  localizacao: string | null
  capturedAt: string
  /** indo = se aproximando do destino da viagem em curso; voltando = se aproximando da origem; null = sem rota cadastrada, ou parado num Local (ver localAtual) */
  sentido: 'indo' | 'voltando' | null
  /** parado num Local cadastrado (geofence) — sobrepõe indo/voltando (pedido do usuário 2026-08-03, caso TBH2C02: aparecia "voltando" já dentro da UPC) */
  localAtual: { nome: string; tipo: string; chegada: string } | null
  /** dados da última viagem (composição em curso) — pedido do usuário 2026-08-12: ao clicar na placa no mapa, mostrar dia da saída, previsão de retorno e velocidade média (real, das leituras do rastreador) */
  ultimaViagem: { dataSaida: string | null; previsaoRetorno: string | null; velocidadeMediaKmh: number | null } | null
  /** placa com VehicleMaintenance em aberto — destacada no mapa (pedido do usuário 2026-08-17: "apontar no mapa para avaliação dos locais que estão se iniciando as manutenções") */
  emManutencao?: boolean
}

const SENTIDO_COR: Record<'indo' | 'voltando' | 'sem_rota' | 'no_local' | 'manutencao', string> = {
  indo: '#2563eb',
  voltando: '#c2410c',
  sem_rota: '#64748b',
  no_local: '#7c3aed',
  manutencao: '#b91c1c',
}
const SENTIDO_LABEL: Record<'indo' | 'voltando' | 'sem_rota' | 'no_local' | 'manutencao', string> = {
  indo: 'indo ao destino',
  voltando: 'voltando à origem',
  sem_rota: 'sentido desconhecido (sem rota cadastrada)',
  no_local: 'parado no local',
  manutencao: '🔧 em manutenção',
}

function fmtDuracaoCurta(min: number): string {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m > 0 ? `${h}h${m}min` : `${h}h`
}

function fmtDataHoraCurta(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

interface MapaFrotaProps {
  locations: LocationMarker[]
  positions: VehiclePositionMarker[]
  /** placa selecionada fora do mapa (ex.: clique na tabela ao lado) — centraliza e abre o balão desse caminhão */
  selectedPlaca?: string | null
  /** coordenada avulsa a focar (ex.: local de pernoite não identificado, aba Pernoite) — pedido do usuário 2026-08-17: "é preciso clicar e ir para o mapa identificar o local para o devido cadastro" */
  focusCoord?: { lat: number; lng: number } | null
}

/**
 * Mapa de posição da frota (pedido do usuário 2026-07-30, integração
 * Omnilink): mostra os Locais cadastrados (com latitude/longitude) e a
 * última posição conhecida de cada placa (`VehiclePosition`). Como a
 * integração Omnilink ainda não tem endpoint/credenciais reais, `positions`
 * normalmente vem vazio — o mapa já fica pronto para exibir assim que os
 * dados começarem a chegar, sem precisar de nova tela.
 */
export function MapaFrota({ locations, positions, selectedPlaca, focusCoord }: MapaFrotaProps) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  const mapRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  // Guardados para o efeito de seleção (clique na placa fora do mapa) poder
  // centralizar e abrir o balão sem precisar recriar os marcadores.
  const mapInstanceRef = useRef<google.maps.Map | null>(null)
  const markersByPlacaRef = useRef<Map<string, google.maps.Marker>>(new Map())
  const infoWindowsByPlacaRef = useRef<Map<string, google.maps.InfoWindow>>(new Map())
  // Marcador temporário para uma coordenada avulsa (não é um caminhão nem um
  // Local cadastrado — ex.: local de pernoite ainda sem identificação).
  const focusMarkerRef = useRef<google.maps.Marker | null>(null)

  // Centraliza e abre o balão do caminhão selecionado (clique na placa fora
  // do mapa, ex.: painel lateral ou tabela) — pedido do usuário 2026-08-03:
  // "preciso clicar na placa e ver qual é o caminhão".
  function focarPlaca(placa: string) {
    const map = mapInstanceRef.current
    const marker = markersByPlacaRef.current.get(placa)
    if (!map || !marker) return
    const position = marker.getPosition()
    if (position) {
      map.panTo(position)
      const zoom = map.getZoom()
      if (zoom == null || zoom < 13) map.setZoom(13)
    }
    for (const [p, iw] of infoWindowsByPlacaRef.current) {
      if (p !== placa) iw.close()
    }
    infoWindowsByPlacaRef.current.get(placa)?.open({ map, anchor: marker })
  }

  // Reage a uma nova seleção sem recriar o mapa inteiro (mapa já construído,
  // usuário clica noutra placa na lista/painel ao lado).
  useEffect(() => {
    if (selectedPlaca) focarPlaca(selectedPlaca)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlaca])

  // Centraliza numa coordenada avulsa (ex.: local de pernoite sem cadastro,
  // aba Pernoite do Rastreamento) — pedido do usuário 2026-08-17: "é preciso
  // clicar e ir para o mapa identificar o local para o devido cadastro".
  // Zoom alto (18) para dar pra reconhecer visualmente o que tem ali (imagem
  // de satélite/rua), diferente do zoom de frota (13) usado para caminhões.
  function focarCoordenada(coord: { lat: number; lng: number }) {
    const map = mapInstanceRef.current
    if (!map || !window.google) return
    const { maps } = window.google
    map.panTo(coord)
    map.setZoom(18)
    focusMarkerRef.current?.setMap(null)
    focusMarkerRef.current = new maps.Marker({
      position: coord,
      map,
      title: 'Local de pernoite não identificado',
      icon: {
        path: maps.SymbolPath.BACKWARD_CLOSED_ARROW,
        scale: 6,
        rotation: 180,
        fillColor: '#be123c',
        fillOpacity: 1,
        strokeColor: '#fff',
        strokeWeight: 2,
      },
    })
  }

  useEffect(() => {
    if (focusCoord) focarCoordenada(focusCoord)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusCoord])

  useEffect(() => {
    if (!apiKey || !mapRef.current) return
    let cancelled = false

    loadGoogleMaps(apiKey)
      .then(() => {
        if (cancelled || !mapRef.current || !window.google) return
        const { maps } = window.google
        // ACHADO REAL 2026-08-19: `panTo`/`setZoom` chamados logo após `new
        // maps.Map(...)`, antes do mapa ter uma projeção pronta, podem não
        // ter efeito no centro (o zoom chega a aplicar, mas o centro fica
        // no valor do construtor) — passar o centro/zoom já prontos na
        // criação do mapa evita depender de um pan pós-construção funcionar.
        const map = new maps.Map(mapRef.current, {
          center: focusCoord ?? { lat: -18.5, lng: -44 }, // centro provisório (região de operação) até ter marcadores
          zoom: focusCoord ? 18 : 6,
          mapTypeId: 'roadmap',
        })
        mapInstanceRef.current = map
        markersByPlacaRef.current = new Map()
        infoWindowsByPlacaRef.current = new Map()

        const bounds = new maps.LatLngBounds()
        let hasBounds = false

        for (const loc of locations) {
          const info = new maps.InfoWindow({
            content: `<strong>${loc.name}</strong><br/>${LOCATION_LABEL[loc.type]}`,
          })
          const cor = LOCATION_COR[loc.type]

          if (loc.polygon && loc.polygon.length >= 3) {
            const polygon = new maps.Polygon({
              paths: loc.polygon,
              map,
              fillColor: cor,
              fillOpacity: 0.25,
              strokeColor: cor,
              strokeWeight: 2,
            })
            polygon.addListener('click', (e: google.maps.MapMouseEvent) => {
              info.setPosition(e.latLng)
              info.open({ map })
            })
            for (const p of loc.polygon) bounds.extend(p)
            hasBounds = true
            continue
          }

          if (loc.latitude == null || loc.longitude == null) continue
          const position = { lat: loc.latitude, lng: loc.longitude }
          const marker = new maps.Marker({
            position,
            map,
            title: loc.name,
            icon: {
              path: maps.SymbolPath.CIRCLE,
              scale: 8,
              fillColor: cor,
              fillOpacity: 1,
              strokeColor: '#fff',
              strokeWeight: 2,
            },
          })
          marker.addListener('click', () => info.open({ map, anchor: marker }))
          bounds.extend(position)
          hasBounds = true
        }

        for (const pos of positions) {
          const position = { lat: pos.latitude, lng: pos.longitude }
          // Manutenção tem prioridade máxima na cor — sobrepõe até "parado no
          // local" (pedido do usuário 2026-08-17): é o sinal mais relevante
          // para avaliação visual de onde as manutenções estão concentradas.
          const sentidoKey: 'indo' | 'voltando' | 'sem_rota' | 'no_local' | 'manutencao' = pos.emManutencao
            ? 'manutencao'
            : pos.localAtual
              ? 'no_local'
              : (pos.sentido ?? 'sem_rota')
          const localAtualTxt = pos.localAtual
            ? `${pos.localAtual.nome} (há ${fmtDuracaoCurta(Math.round((Date.now() - new Date(pos.localAtual.chegada).getTime()) / 60_000))})`
            : null
          // Em manutenção tem prioridade no texto também — combina com o local
          // (se houver) em vez de escondê-lo, já que "onde a manutenção está
          // acontecendo" é justamente o que o usuário quer avaliar.
          const statusTxt = pos.emManutencao
            ? localAtualTxt
              ? `🔧 em manutenção, no local: ${localAtualTxt}`
              : '🔧 em manutenção'
            : localAtualTxt
              ? `no local: ${localAtualTxt}`
              : SENTIDO_LABEL[sentidoKey]
          const marker = new maps.Marker({
            position,
            map,
            title: `${pos.placa} — ${statusTxt}`,
            icon: {
              // Material Icons "local_shipping" (viewBox 24x24) — ícone de caminhão real.
              // Sem rotação: é um pictograma (rodas/cabine fixas), não uma seta —
              // girado ele fica de cabeça para baixo em vez de indicar direção
              // (pedido do usuário 2026-08-03). O sentido (indo/voltando) é
              // mostrado pela cor, calculado a partir da rota, não do heading —
              // e cede lugar à cor "parado no local" quando há visita aberta
              // (pedido do usuário 2026-08-03, caso TBH2C02: aparecia "voltando"
              // já dentro da UPC, o que é enganoso — já chegou e está parado).
              path: 'M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4zM6 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm13.5-9l1.96 2.5H17V9.5h2.5zM18 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z',
              scale: 0.7,
              anchor: new maps.Point(12, 12),
              fillColor: SENTIDO_COR[sentidoKey],
              fillOpacity: 1,
              strokeColor: '#fff',
              strokeWeight: 1,
            },
          })
          const atualizado = new Date(pos.capturedAt).toLocaleString('pt-BR')
          const sentidoLinha = statusTxt
          // Dados da última viagem — pedido do usuário 2026-08-12: ao clicar
          // na placa/composição no mapa, mostrar dia da saída, previsão de
          // retorno e velocidade média (real, calculada a partir das leituras
          // do rastreador durante a viagem, não a velocidade padrão de
          // planejamento).
          const uv = pos.ultimaViagem
          const ultimaViagemHtml = uv
            ? `<div style="margin-top:4px;padding-top:4px;border-top:1px solid #e2e8f0;font-size:11px;color:#334155">
                <strong>Última viagem</strong><br/>
                ${uv.dataSaida ? `Saída: ${fmtDataHoraCurta(uv.dataSaida)}<br/>` : ''}
                ${uv.previsaoRetorno ? `Previsão de retorno: ${fmtDataHoraCurta(uv.previsaoRetorno)}<br/>` : ''}
                ${uv.velocidadeMediaKmh != null ? `Velocidade média: ${uv.velocidadeMediaKmh} km/h` : ''}
              </div>`
            : ''
          // Botões de atalho — pedido do usuário 2026-08-12: "colocar pequenos
          // botões que direcionam para o detalhe da composição e da viagem".
          // Links simples (o InfoWindow é HTML puro, fora da árvore React) —
          // levam para Cadastros → Composições (filtrado pela placa) e para o
          // modal de detalhamento da viagem atual na Fase1Dashboard, que já
          // sabe abrir sozinho via ?abrirDetalhe=PLACA.
          const placaEnc = encodeURIComponent(pos.placa)
          const linksHtml = `<div style="margin-top:6px;display:flex;gap:6px">
              <a href="/dashboard/admin/composicoes?placa=${placaEnc}" style="font-size:11px;padding:2px 8px;border-radius:6px;background:#f1f5f9;color:#334155;text-decoration:none">Ver composição</a>
              <a href="/dashboard/fase1?abrirDetalhe=${placaEnc}" style="font-size:11px;padding:2px 8px;border-radius:6px;background:#f1f5f9;color:#334155;text-decoration:none">Ver viagem</a>
            </div>`
          const info = new maps.InfoWindow({
            content: `<strong>${pos.placa}</strong> · <span style="color:${SENTIDO_COR[sentidoKey]}">${sentidoLinha}</span><br/>${pos.speedKmh != null ? `${pos.speedKmh} km/h` : ''} ${pos.status ?? ''}${pos.localizacao ? `<br/>${pos.localizacao}` : ''}<br/><span style="color:#64748b;font-size:11px">atualizado ${atualizado}</span>${ultimaViagemHtml}${linksHtml}`,
          })
          marker.addListener('click', () => info.open({ map, anchor: marker }))
          markersByPlacaRef.current.set(pos.placa, marker)
          infoWindowsByPlacaRef.current.set(pos.placa, info)
          bounds.extend(position)
          hasBounds = true
        }

        // ACHADO REAL 2026-08-19: `fitBounds` recalcula o zoom de forma
        // assíncrona internamente (o efeito só se aplica depois do mapa
        // ficar "idle") — chamar panTo/setZoom logo em seguida, de forma
        // síncrona, corria risco de ser sobrescrito pelo fitBounds atrasado,
        // mesmo com a nossa chamada vindo depois no código (tentativa
        // anterior com `addListenerOnce(map, 'idle', ...)` não bastou).
        // Mais simples e robusto: quando há uma coordenada específica pra
        // focar, nem chama fitBounds — a visão da frota inteira não importa
        // nesse caso, elimina a corrida por completo em vez de tentar vencê-la.
        if (focusCoord) {
          focarCoordenada(focusCoord)
        } else if (hasBounds) {
          map.fitBounds(bounds)
        }
        if (selectedPlaca) focarPlaca(selectedPlaca)
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))

    return () => {
      cancelled = true
    }
  }, [apiKey, locations, positions])

  if (!apiKey) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900">
        <h1 className="text-lg font-semibold">Mapa da frota</h1>
        <p className="mt-2">
          A chave do Google Maps ainda não foi configurada. Preencha{' '}
          <code className="rounded bg-amber-100 px-1">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> no <code>.env</code>{' '}
          (Maps JavaScript API habilitada no Google Cloud Console) e reinicie o servidor.
        </p>
      </div>
    )
  }

  return (
    <div>
      <p className="mb-2 text-sm text-slate-500">
        {locations.length} local(is) cadastrado(s) com coordenadas · {positions.length} caminhão(ões) com posição
        conhecida
        {positions.length === 0 && ' (sem posição de caminhão no momento)'}
      </p>
      {error && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-800">
          Erro ao carregar o mapa: {error}
        </div>
      )}
      {locations.length === 0 && positions.length === 0 && (
        <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-600">
          Nenhum local tem latitude/longitude cadastrada ainda. Preencha as coordenadas em{' '}
          <a href="/dashboard/admin/locais" className="text-emerald-700 underline">
            Cadastros → Locais
          </a>{' '}
          para vê-los aqui.
        </div>
      )}
      <div ref={mapRef} className="h-[350px] w-full rounded-xl border border-slate-200 sm:h-[450px] lg:h-[600px]" />
    </div>
  )
}
