'use client'

import { useEffect, useRef, useState } from 'react'

interface LocationMarker {
  id: string
  name: string
  type: 'UNIDADE' | 'CLIENTE'
  latitude: number
  longitude: number
  raioMetros: number
}

interface VehiclePositionMarker {
  placa: string
  latitude: number
  longitude: number
  speedKmh: number | null
  heading: number | null
  status: string | null
  capturedAt: string
}

interface MapaFrotaProps {
  locations: LocationMarker[]
  positions: VehiclePositionMarker[]
}

// Carrega a Maps JavaScript API uma única vez (o script global fica cacheado
// entre navegações/remounts do componente dentro da mesma sessão do navegador).
let googleMapsPromise: Promise<void> | null = null
function loadGoogleMaps(apiKey: string): Promise<void> {
  if (typeof window !== 'undefined' && window.google?.maps) return Promise.resolve()
  if (googleMapsPromise) return googleMapsPromise
  googleMapsPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}`
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Falha ao carregar o script do Google Maps'))
    document.head.appendChild(script)
  })
  return googleMapsPromise
}

declare global {
  interface Window {
    google?: { maps: typeof google.maps }
  }
}

/**
 * Mapa de posição da frota (pedido do usuário 2026-07-30, integração
 * Omnilink): mostra os Locais cadastrados (com latitude/longitude) e a
 * última posição conhecida de cada placa (`VehiclePosition`). Como a
 * integração Omnilink ainda não tem endpoint/credenciais reais, `positions`
 * normalmente vem vazio — o mapa já fica pronto para exibir assim que os
 * dados começarem a chegar, sem precisar de nova tela.
 */
export function MapaFrota({ locations, positions }: MapaFrotaProps) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  const mapRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!apiKey || !mapRef.current) return
    let cancelled = false

    loadGoogleMaps(apiKey)
      .then(() => {
        if (cancelled || !mapRef.current || !window.google) return
        const { maps } = window.google
        const map = new maps.Map(mapRef.current, {
          center: { lat: -18.5, lng: -44 }, // centro provisório (região de operação) até ter marcadores
          zoom: 6,
          mapTypeId: 'roadmap',
        })

        const bounds = new maps.LatLngBounds()
        let hasBounds = false

        for (const loc of locations) {
          const position = { lat: loc.latitude, lng: loc.longitude }
          const marker = new maps.Marker({
            position,
            map,
            title: loc.name,
            icon: {
              path: maps.SymbolPath.CIRCLE,
              scale: 8,
              fillColor: loc.type === 'UNIDADE' ? '#047857' : '#0891b2',
              fillOpacity: 1,
              strokeColor: '#fff',
              strokeWeight: 2,
            },
          })
          const info = new maps.InfoWindow({
            content: `<strong>${loc.name}</strong><br/>${loc.type === 'UNIDADE' ? 'Unidade do grupo' : 'Cliente'}`,
          })
          marker.addListener('click', () => info.open({ map, anchor: marker }))
          bounds.extend(position)
          hasBounds = true
        }

        for (const pos of positions) {
          const position = { lat: pos.latitude, lng: pos.longitude }
          const marker = new maps.Marker({
            position,
            map,
            title: pos.placa,
            icon: {
              path: 'M -2 -1 L 2 -1 L 2 1 L -2 1 Z', // ícone simples de caminhão (retângulo)
              scale: 6,
              rotation: pos.heading ?? 0,
              fillColor: '#c2410c',
              fillOpacity: 1,
              strokeColor: '#fff',
              strokeWeight: 1,
            },
          })
          const atualizado = new Date(pos.capturedAt).toLocaleString('pt-BR')
          const info = new maps.InfoWindow({
            content: `<strong>${pos.placa}</strong><br/>${pos.speedKmh != null ? `${pos.speedKmh} km/h` : ''} ${pos.status ?? ''}<br/><span style="color:#64748b;font-size:11px">atualizado ${atualizado}</span>`,
          })
          marker.addListener('click', () => info.open({ map, anchor: marker }))
          bounds.extend(position)
          hasBounds = true
        }

        if (hasBounds) map.fitBounds(bounds)
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
      <div className="mb-4">
        <h1 className="text-xl font-semibold">Mapa da frota</h1>
        <p className="mt-1 text-sm text-slate-500">
          {locations.length} local(is) cadastrado(s) com coordenadas · {positions.length} caminhão(ões) com posição
          conhecida
          {positions.length === 0 && ' (rastreamento Omnilink ainda não integrado — sem posições de caminhão por enquanto)'}
        </p>
      </div>
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
      <div ref={mapRef} className="h-[600px] w-full rounded-xl border border-slate-200" />
    </div>
  )
}
