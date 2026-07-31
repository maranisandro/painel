import { redirect } from 'next/navigation'
import { getSessionUser, hasModuleAccess } from '@/lib/authz'
import { prisma } from '@/lib/prisma'
import { MapaFrota } from '@/components/fase1/MapaFrota'

export const dynamic = 'force-dynamic'

export default async function MapaPage() {
  const user = await getSessionUser()
  if (!hasModuleAccess(user, 'fase1')) redirect('/dashboard')

  const locations = await prisma.location.findMany({
    where: { active: true, latitude: { not: null }, longitude: { not: null } },
    select: { id: true, name: true, type: true, latitude: true, longitude: true, raioMetros: true },
    orderBy: { name: 'asc' },
  })

  // Última posição conhecida de cada placa (VehiclePosition ainda vazio até
  // a integração Omnilink ter endpoint/credenciais reais — ver pendência no
  // Obsidian). Agrupamento feito em memória: volume esperado é baixo (uma
  // linha por placa ativa), não justifica SQL bruto por enquanto.
  const allPositions = await prisma.vehiclePosition.findMany({
    orderBy: { capturedAt: 'desc' },
  })
  const latestByPlaca = new Map<string, (typeof allPositions)[number]>()
  for (const p of allPositions) {
    if (!latestByPlaca.has(p.placa)) latestByPlaca.set(p.placa, p)
  }

  return (
    <MapaFrota
      locations={locations.map((l) => ({
        id: l.id,
        name: l.name,
        type: l.type,
        latitude: l.latitude!,
        longitude: l.longitude!,
        raioMetros: l.raioMetros ?? 500,
      }))}
      positions={[...latestByPlaca.values()].map((p) => ({
        placa: p.placa,
        latitude: p.latitude,
        longitude: p.longitude,
        speedKmh: p.speedKmh,
        heading: p.heading,
        status: p.status,
        capturedAt: p.capturedAt.toISOString(),
      }))}
    />
  )
}
