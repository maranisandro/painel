import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, hasModuleAccess } from '@/lib/authz'
import { prisma } from '@/lib/prisma'
import { horasRodandoGps } from '@/lib/fase1/disponibilidade'

/**
 * Horas rodando por placa (GPS real, Omnilink) no período — usado como uma
 * das 3 variantes de Eficiência Operacional pedidas pelo usuário 2026-08-17.
 * Único dado desta função que não vem de `/api/fase1/data` (posição de GPS
 * não faz parte do payload principal, é grande demais) — os demais números
 * (km, viagens, manutenção) são calculados no cliente a partir do que já
 * está carregado.
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser()
  if (!hasModuleAccess(user, 'fase1')) return NextResponse.json({ error: 'acesso negado' }, { status: 403 })

  const from = req.nextUrl.searchParams.get('from')
  const to = req.nextUrl.searchParams.get('to')
  if (!from || !to) return NextResponse.json({ error: 'from/to obrigatórios' }, { status: 400 })

  const posicoes = await prisma.vehiclePosition.findMany({
    where: { capturedAt: { gte: new Date(`${from}T00:00:00`), lte: new Date(`${to}T23:59:59`) } },
    select: { placa: true, capturedAt: true, speedKmh: true },
    orderBy: [{ placa: 'asc' }, { capturedAt: 'asc' }],
  })

  const porPlaca = new Map<string, { capturedAt: string; speedKmh: number | null }[]>()
  for (const p of posicoes) {
    const lista = porPlaca.get(p.placa) ?? []
    lista.push({ capturedAt: p.capturedAt.toISOString(), speedKmh: p.speedKmh })
    porPlaca.set(p.placa, lista)
  }

  const resultado = [...porPlaca.entries()].map(([placa, lista]) => ({
    placa,
    horasRodando: Math.round(horasRodandoGps(lista) * 10) / 10,
  }))

  return NextResponse.json(resultado)
}
