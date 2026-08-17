/** Distância em km entre duas coordenadas (fórmula de haversine). */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const sa =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(sa))
}

/** Ray casting — ponto dentro do polígono (lat/lng tratados como plano, ok para áreas pequenas como pátio/fazenda). */
export function pointInPolygon(p: { lat: number; lng: number }, polygon: { lat: number; lng: number }[]): boolean {
  let dentro = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const vi = polygon[i]
    const vj = polygon[j]
    const intersecta =
      vi.lng > p.lng !== vj.lng > p.lng &&
      p.lat < ((vj.lat - vi.lat) * (p.lng - vi.lng)) / (vj.lng - vi.lng) + vi.lat
    if (intersecta) dentro = !dentro
  }
  return dentro
}

export interface GeofenceLocation {
  id: string
  latitude: number | null
  longitude: number | null
  raioMetros: number | null
  polygon: { lat: number; lng: number }[] | null
}

/** Local (ponto+raio OU polígono) que contém a posição informada, se houver. */
export function findContainingLocation<T extends GeofenceLocation>(
  point: { lat: number; lng: number },
  locations: T[],
): T | null {
  for (const loc of locations) {
    if (loc.polygon && loc.polygon.length >= 3) {
      if (pointInPolygon(point, loc.polygon)) return loc
      continue
    }
    if (loc.latitude != null && loc.longitude != null) {
      const distMetros = haversineKm(point, { lat: loc.latitude, lng: loc.longitude }) * 1000
      if (distMetros <= (loc.raioMetros ?? 500)) return loc
    }
  }
  return null
}
