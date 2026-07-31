'use client'

// Carrega a Maps JavaScript API uma única vez por sessão do navegador —
// compartilhado entre o mapa da frota (src/components/fase1/MapaFrota.tsx)
// e o desenhador de forma dos Locais (src/components/admin/LocationShapeMap.tsx).
let googleMapsPromise: Promise<void> | null = null

export function loadGoogleMaps(apiKey: string, libraries: string[] = []): Promise<void> {
  if (typeof window !== 'undefined' && window.google?.maps && libraries.every((l) => (window.google!.maps as any)[l])) {
    return Promise.resolve()
  }
  if (googleMapsPromise) return googleMapsPromise
  googleMapsPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    const libParam = libraries.length ? `&libraries=${libraries.join(',')}` : ''
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}${libParam}`
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
