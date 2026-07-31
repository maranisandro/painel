'use client'

import { useEffect, useRef, useState } from 'react'
import { loadGoogleMaps } from '@/lib/google-maps'

export interface LocationShapeValue {
  latitude: number | null
  longitude: number | null
  raioMetros: number | null
  polygon: { lat: number; lng: number }[] | null
}

interface LocationShapeMapProps {
  value: LocationShapeValue
  onChange: (value: LocationShapeValue) => void
}

type Modo = 'idle' | 'circulo' | 'poligono'

/**
 * Desenhador de forma de um Local (pedido do usuário 2026-07-30: "colocar um
 * ponto com raio ou polígono"). Um Local usa SÓ uma forma por vez — desenhar
 * uma nova substitui a anterior.
 *
 * Não usa `google.maps.drawing.DrawingManager`: o Google **descontinuou essa
 * biblioteca** na versão atual da Maps JavaScript API (3.65+, confirmado ao
 * vivo — a classe existe no client mas não tem mais `setMap`/`setDrawingMode`
 * em runtime). O desenho é feito na mão: modo "círculo" = 1 clique define o
 * centro (raio inicial 500m, depois arraste as alças pra ajustar); modo
 * "polígono" = clique para cada vértice, botão "Concluir" fecha a forma.
 */
export function LocationShapeMap({ value, onChange }: LocationShapeMapProps) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  const mapRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [modo, setModo] = useState<Modo>('idle')
  const [pontosPoligono, setPontosPoligono] = useState(0)

  const stateRef = useRef<{
    map: google.maps.Map | null
    overlay: google.maps.Circle | google.maps.Polygon | null
    pendingPath: google.maps.LatLng[]
    pendingLine: google.maps.Polyline | null
    pendingMarkers: google.maps.Marker[]
    clickListener: google.maps.MapsEventListener | null
  }>({ map: null, overlay: null, pendingPath: [], pendingLine: null, pendingMarkers: [], clickListener: null })
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const modoRef = useRef<Modo>('idle')

  function clearOverlay() {
    stateRef.current.overlay?.setMap(null)
    stateRef.current.overlay = null
  }

  function clearPending() {
    stateRef.current.pendingLine?.setMap(null)
    stateRef.current.pendingLine = null
    for (const m of stateRef.current.pendingMarkers) m.setMap(null)
    stateRef.current.pendingMarkers = []
    stateRef.current.pendingPath = []
    setPontosPoligono(0)
  }

  function attachCircleListeners(circle: google.maps.Circle) {
    const emit = () => {
      const center = circle.getCenter()
      if (!center) return
      onChangeRef.current({
        latitude: center.lat(),
        longitude: center.lng(),
        raioMetros: Math.round(circle.getRadius()),
        polygon: null,
      })
    }
    circle.addListener('radius_changed', emit)
    circle.addListener('center_changed', emit)
    emit()
  }

  function attachPolygonListeners(polygon: google.maps.Polygon) {
    const emit = () => {
      const path = polygon
        .getPath()
        .getArray()
        .map((p) => ({ lat: p.lat(), lng: p.lng() }))
      onChangeRef.current({ latitude: null, longitude: null, raioMetros: null, polygon: path })
    }
    const path = polygon.getPath()
    path.addListener('set_at', emit)
    path.addListener('insert_at', emit)
    path.addListener('remove_at', emit)
    emit()
  }

  function finalizarPoligono() {
    const { map, pendingPath } = stateRef.current
    if (!map || pendingPath.length < 3 || !window.google) return
    clearOverlay()
    const polygon = new window.google.maps.Polygon({
      paths: pendingPath,
      map,
      editable: true,
      draggable: true,
      fillColor: '#0891b2',
      fillOpacity: 0.25,
      strokeColor: '#0891b2',
    })
    stateRef.current.overlay = polygon
    attachPolygonListeners(polygon)
    clearPending()
    setModo('idle')
    modoRef.current = 'idle'
  }

  useEffect(() => {
    if (!apiKey || !mapRef.current) return
    let cancelled = false

    loadGoogleMaps(apiKey).then(() => {
      if (cancelled || !mapRef.current || !window.google) return
      const { maps } = window.google

      const hasPoint = value.latitude != null && value.longitude != null
      const hasPolygon = !!value.polygon && value.polygon.length >= 3
      const center = hasPoint
        ? { lat: value.latitude!, lng: value.longitude! }
        : hasPolygon
          ? value.polygon![0]
          : { lat: -18.5, lng: -44 }

      const map = new maps.Map(mapRef.current, {
        center,
        zoom: hasPoint || hasPolygon ? 15 : 6,
        mapTypeId: 'hybrid',
      })
      stateRef.current.map = map

      if (hasPoint) {
        const circle = new maps.Circle({
          center,
          radius: value.raioMetros ?? 500,
          map,
          editable: true,
          draggable: true,
          fillColor: '#047857',
          fillOpacity: 0.2,
          strokeColor: '#047857',
        })
        stateRef.current.overlay = circle
        attachCircleListeners(circle)
      } else if (hasPolygon) {
        const polygon = new maps.Polygon({
          paths: value.polygon!,
          map,
          editable: true,
          draggable: true,
          fillColor: '#0891b2',
          fillOpacity: 0.2,
          strokeColor: '#0891b2',
        })
        stateRef.current.overlay = polygon
        attachPolygonListeners(polygon)
      }

      // Clique no mapa: só faz algo quando um modo de desenho está ativo
      // (lido via ref, não via closure, porque o listener é criado uma vez só).
      stateRef.current.clickListener = map.addListener('click', (e: google.maps.MapMouseEvent) => {
        if (!e.latLng) return
        if (modoRef.current === 'circulo') {
          clearOverlay()
          const circle = new maps.Circle({
            center: e.latLng,
            radius: 500,
            map,
            editable: true,
            draggable: true,
            fillColor: '#047857',
            fillOpacity: 0.2,
            strokeColor: '#047857',
          })
          stateRef.current.overlay = circle
          attachCircleListeners(circle)
          setModo('idle')
          modoRef.current = 'idle'
        } else if (modoRef.current === 'poligono') {
          stateRef.current.pendingPath.push(e.latLng)
          const marker = new maps.Marker({
            position: e.latLng,
            map,
            icon: { path: maps.SymbolPath.CIRCLE, scale: 4, fillColor: '#0891b2', fillOpacity: 1, strokeWeight: 0 },
          })
          stateRef.current.pendingMarkers.push(marker)
          stateRef.current.pendingLine?.setMap(null)
          stateRef.current.pendingLine = new maps.Polyline({
            path: stateRef.current.pendingPath,
            map,
            strokeColor: '#0891b2',
            strokeWeight: 2,
          })
          setPontosPoligono(stateRef.current.pendingPath.length)
        }
      })
    }).catch((err) => setError(err instanceof Error ? err.message : String(err)))

    return () => {
      cancelled = true
      if (stateRef.current.clickListener) window.google?.maps.event.removeListener(stateRef.current.clickListener)
      clearPending()
      stateRef.current.overlay?.setMap(null)
    }
    // Só monta uma vez por local editado — recriar o mapa a cada tecla digitada
    // no formulário destruiria a forma que o usuário está desenhando.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey])

  function iniciarModo(novo: Modo) {
    clearPending()
    setModo(novo)
    modoRef.current = novo
  }

  function limpar() {
    clearPending()
    clearOverlay()
    setModo('idle')
    modoRef.current = 'idle'
    onChange({ latitude: null, longitude: null, raioMetros: null, polygon: null })
  }

  if (!apiKey) {
    return (
      <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
        Configure <code className="rounded bg-amber-100 px-1">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> no <code>.env</code> para
        desenhar a forma do local no mapa.
      </p>
    )
  }

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => iniciarModo('circulo')}
          className={`rounded-md border px-2 py-1 text-xs ${modo === 'circulo' ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : 'border-slate-300 hover:bg-slate-50'}`}
        >
          ⊙ Desenhar círculo (clique no mapa)
        </button>
        <button
          type="button"
          onClick={() => iniciarModo('poligono')}
          className={`rounded-md border px-2 py-1 text-xs ${modo === 'poligono' ? 'border-cyan-600 bg-cyan-50 text-cyan-800' : 'border-slate-300 hover:bg-slate-50'}`}
        >
          ⬠ Desenhar polígono (clique para cada ponto)
        </button>
        {modo === 'poligono' && (
          <button
            type="button"
            onClick={finalizarPoligono}
            disabled={pontosPoligono < 3}
            className="rounded-md border border-cyan-600 bg-cyan-600 px-2 py-1 text-xs text-white disabled:opacity-40"
          >
            Concluir polígono ({pontosPoligono} ponto{pontosPoligono === 1 ? '' : 's'})
          </button>
        )}
        <button type="button" onClick={limpar} className="ml-auto text-xs text-red-600 hover:underline">
          limpar forma
        </button>
      </div>
      <p className="mb-1 text-xs text-slate-500">
        Desenhar uma forma nova substitui a anterior. Depois de pronta, arraste os pontos da forma (não os botões
        acima) para ajustar.
      </p>
      {error && <p className="mb-1 text-xs text-red-600">Erro ao carregar o mapa: {error}</p>}
      <div ref={mapRef} className="h-[350px] w-full rounded-md border border-slate-200" />
    </div>
  )
}
