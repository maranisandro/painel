'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'

const HEARTBEAT_INTERVAL_MS = 30_000

function sendEvent(type: 'PAGE_VIEW' | 'HEARTBEAT', path: string) {
  const body = JSON.stringify({ type, path })
  if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
    const ok = navigator.sendBeacon('/api/telemetry/event', new Blob([body], { type: 'application/json' }))
    if (ok) return
  }
  fetch('/api/telemetry/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {})
}

/**
 * Rastreamento de uso (pedido do usuário 2026-08-28/29) — manda PAGE_VIEW a
 * cada navegação e HEARTBEAT a cada 30s só enquanto a aba está visível e em
 * foco, para medir "tempo de uso ativo com navegação real" (não abas
 * abertas em segundo plano). Sem UI própria.
 */
export function UsageTracker() {
  const pathname = usePathname()
  const lastPathRef = useRef<string | null>(null)

  useEffect(() => {
    if (!pathname || lastPathRef.current === pathname) return
    lastPathRef.current = pathname
    sendEvent('PAGE_VIEW', pathname)
  }, [pathname])

  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible' && document.hasFocus() && lastPathRef.current) {
        sendEvent('HEARTBEAT', lastPathRef.current)
      }
    }, HEARTBEAT_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [])

  return null
}
