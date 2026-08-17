import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, hasModuleAccess } from '@/lib/authz'
import { prisma } from '@/lib/prisma'

/**
 * Última posição GPS conhecida + visita em aberto (LocationVisit) de uma
 * placa — usado pelo card de comunicação Omnilink no modal de detalhamento
 * (aba Por Placa), pedido do usuário 2026-08-17: "talvez na aba por placa
 * tentar um modal para ter a informação por placa destas comunicações".
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser()
  if (!hasModuleAccess(user, 'fase1')) return NextResponse.json({ error: 'acesso negado' }, { status: 403 })

  const placa = req.nextUrl.searchParams.get('placa')?.trim().toUpperCase()
  if (!placa) return NextResponse.json({ error: 'placa é obrigatória' }, { status: 400 })

  const [ultimaPosicao, visitaAberta, ultimosLogs] = await Promise.all([
    prisma.vehiclePosition.findFirst({
      where: { placa },
      orderBy: { capturedAt: 'desc' },
      select: { capturedAt: true, latitude: true, longitude: true, localizacao: true, status: true },
    }),
    prisma.locationVisit.findFirst({
      where: { placa, saida: null },
      include: { location: { select: { name: true } } },
    }),
    prisma.omnilinkSyncPlaca.findMany({
      where: { placa },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { status: true, rowsRecebidas: true, ultimaPosicaoEm: true, mensagem: true, manual: true, createdAt: true },
    }),
  ])

  return NextResponse.json({
    ultimaPosicao: ultimaPosicao
      ? {
          capturedAt: ultimaPosicao.capturedAt.toISOString(),
          latitude: ultimaPosicao.latitude,
          longitude: ultimaPosicao.longitude,
          localizacao: ultimaPosicao.localizacao,
          status: ultimaPosicao.status,
        }
      : null,
    localAtual: visitaAberta ? { nome: visitaAberta.location.name, chegada: visitaAberta.chegada.toISOString() } : null,
    ultimosLogs: ultimosLogs.map((l) => ({
      status: l.status,
      rowsRecebidas: l.rowsRecebidas,
      ultimaPosicaoEm: l.ultimaPosicaoEm ? l.ultimaPosicaoEm.toISOString() : null,
      mensagem: l.mensagem,
      manual: l.manual,
      createdAt: l.createdAt.toISOString(),
    })),
  })
}
