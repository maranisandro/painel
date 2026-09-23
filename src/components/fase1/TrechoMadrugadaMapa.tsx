'use client'

import { useEffect, useRef, useState } from 'react'
import { loadGoogleMaps } from '@/lib/google-maps'

interface Ponto {
  lat: number
  lng: number
  capturedAt: string
  speedKmh: number | null
  rodando: boolean
}

/**
 * Mapa do trecho rodado de madrugada — pedido do usuário 2026-09-23: "mapa
 * mostrando uma linha entre as posições de rastreio que demonstrem
 * movimento". Desenha uma Polyline por trecho CONTÍNUO de `rodando: true`
 * (inclui o ponto imediatamente anterior, que fecha a ponta da linha) — se
 * o caminhão parou no meio e voltou a andar, aparecem 2+ linhas separadas,
 * de propósito (é o comportamento correto, não uma falha).
 */
export function TrechoMadrugadaMapa({ placa, noite }: { placa: string; noite: string }) {
  const mapRef = useRef<HTMLDivElement>(null)
  const [pontos, setPontos] = useState<Ponto[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let cancelado = false
    fetch(`/api/fase1/rastreamento/noite-rodando/detalhe?placa=${encodeURIComponent(placa)}&noite=${noite}`)
      .then((r) => r.json())
      .then((body) => {
        if (cancelado) return
        if (body.error) setErro(body.error)
        else setPontos(body.pontos)
      })
      .catch(() => {
        if (!cancelado) setErro('Falha ao buscar o trajeto.')
      })
    return () => {
      cancelado = true
    }
  }, [placa, noite])

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
    if (!apiKey || !mapRef.current || !pontos || pontos.length === 0) return
    let cancelado = false

    loadGoogleMaps(apiKey).then(() => {
      if (cancelado || !mapRef.current || !window.google) return
      const { maps } = window.google
      const bounds = new maps.LatLngBounds()
      for (const p of pontos) bounds.extend({ lat: p.lat, lng: p.lng })

      const map = new maps.Map(mapRef.current, { center: bounds.getCenter(), zoom: 12, mapTypeId: 'roadmap' })
      map.fitBounds(bounds)

      // Agrupa em trechos contínuos de `rodando: true` — cada trecho vira
      // uma Polyline própria (inclui o ponto anterior ao primeiro `true`
      // do grupo, pra linha não começar "no ar").
      let trechoAtual: Ponto[] = []
      const trechos: Ponto[][] = []
      for (let i = 0; i < pontos.length; i++) {
        if (pontos[i].rodando) {
          if (trechoAtual.length === 0) trechoAtual.push(pontos[i - 1])
          trechoAtual.push(pontos[i])
        } else if (trechoAtual.length > 0) {
          trechos.push(trechoAtual)
          trechoAtual = []
        }
      }
      if (trechoAtual.length > 0) trechos.push(trechoAtual)

      for (const trecho of trechos) {
        new maps.Polyline({
          path: trecho.map((p) => ({ lat: p.lat, lng: p.lng })),
          map,
          strokeColor: '#047857',
          strokeWeight: 4,
          strokeOpacity: 0.8,
        })
      }

      if (trechos.length === 0) {
        // Nenhum segmento passou no filtro de "rodando" (não deveria
        // acontecer pra uma placa que já apareceu na lista, mas cobre o
        // caso defensivamente) — mostra os pontos como marcadores simples.
        for (const p of pontos) new maps.Marker({ position: { lat: p.lat, lng: p.lng }, map })
      }
    })
    return () => {
      cancelado = true
    }
  }, [pontos])

  if (erro) return <p className="p-3 text-xs text-red-700">{erro}</p>
  if (!pontos) return <p className="p-3 text-xs text-slate-500">Carregando trajeto…</p>
  if (pontos.length === 0) return <p className="p-3 text-xs text-slate-500">Sem posições de GPS para este trecho.</p>
  return <div ref={mapRef} className="h-80 w-full rounded-lg border border-slate-200" />
}
