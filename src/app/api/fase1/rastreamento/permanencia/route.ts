import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, hasModuleAccess } from '@/lib/authz'
import { prisma } from '@/lib/prisma'

// Relatório de permanência por local (chegada/saída detectadas por geofence)
// — pedido do usuário 2026-08-03: "relatórios do tempo que ficou em cada
// local, hora de chegada e saída". Sem `to`, inclui visitas ainda abertas
// (saida null = "ainda está lá").
export async function GET(req: NextRequest) {
  const user = await getSessionUser()
  if (!hasModuleAccess(user, 'fase1')) return NextResponse.json({ error: 'acesso negado' }, { status: 403 })

  const from = req.nextUrl.searchParams.get('from')
  const to = req.nextUrl.searchParams.get('to')
  const placa = req.nextUrl.searchParams.get('placa')?.trim().toUpperCase()

  const visitas = await prisma.locationVisit.findMany({
    where: {
      ...(placa ? { placa } : {}),
      ...(from ? { chegada: { gte: new Date(`${from}T00:00:00`) } } : {}),
      ...(to ? { chegada: { lte: new Date(`${to}T23:59:59`) } } : {}),
    },
    include: { location: { select: { name: true, type: true, motoristaNome: true } } },
    orderBy: { chegada: 'desc' },
    take: 500,
  })

  return NextResponse.json(
    visitas.map((v) => ({
      id: v.id,
      placa: v.placa,
      localNome: v.location.name,
      localTipo: v.location.type,
      motoristaResidencia: v.location.motoristaNome,
      chegada: v.chegada.toISOString(),
      saida: v.saida ? v.saida.toISOString() : null,
      duracaoMinutos: v.saida ? Math.round((v.saida.getTime() - v.chegada.getTime()) / 60_000) : null,
    })),
  )
}
