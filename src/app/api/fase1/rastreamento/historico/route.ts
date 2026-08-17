import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, hasModuleAccess } from '@/lib/authz'
import { prisma } from '@/lib/prisma'

const LIMITE_PONTOS = 300

// Histórico de posições de uma placa (retenção de 60 dias aplicada no
// post-process do sync Omnilink) — usado no drill-down da aba "Última
// posição" (pedido do usuário 2026-08-03: "inserir no painel... o histórico").
export async function GET(req: NextRequest) {
  const user = await getSessionUser()
  if (!hasModuleAccess(user, 'fase1')) return NextResponse.json({ error: 'acesso negado' }, { status: 403 })

  const placa = req.nextUrl.searchParams.get('placa')?.trim().toUpperCase()
  if (!placa) return NextResponse.json({ error: 'placa é obrigatória' }, { status: 400 })

  const historico = await prisma.vehiclePosition.findMany({
    where: { placa },
    orderBy: { capturedAt: 'desc' },
    take: LIMITE_PONTOS,
    select: { capturedAt: true, latitude: true, longitude: true, speedKmh: true, heading: true, status: true, localizacao: true },
  })
  return NextResponse.json(historico)
}
