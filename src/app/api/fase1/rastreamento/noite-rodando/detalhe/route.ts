import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, hasModuleAccess } from '@/lib/authz'
import { prisma } from '@/lib/prisma'
import { diaBrasilDe, horaBrasilDe, diaAnteriorStr } from '@/lib/horario-brasil'
import { segmentosRodandoGps, type PosicaoSimples } from '@/lib/fase1/disponibilidade'

const JANELA_INICIO_HORA = 19
const JANELA_FIM_HORA = 4

function classificarNoite(dia: string, hora: number): string | null {
  if (hora >= JANELA_INICIO_HORA) return dia
  if (hora < JANELA_FIM_HORA) return diaAnteriorStr(dia)
  return null
}

/**
 * Detalhe do trajeto de UMA placa numa madrugada específica — pedido do
 * usuário 2026-09-23: "opção de detalhe com um mapa mostrando uma linha
 * entre as posições de rastreio que demonstrem movimento". Mesmo critério
 * de janela (19h-04h) da rota `noite-rodando`, restrito a uma placa/noite.
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser()
  if (!hasModuleAccess(user, 'fase1')) return NextResponse.json({ error: 'acesso negado' }, { status: 403 })

  const placa = req.nextUrl.searchParams.get('placa')?.trim().toUpperCase()
  const noite = req.nextUrl.searchParams.get('noite')?.trim()
  if (!placa || !noite || !/^\d{4}-\d{2}-\d{2}$/.test(noite)) {
    return NextResponse.json({ error: 'placa e noite (YYYY-MM-DD) são obrigatórios' }, { status: 400 })
  }

  // Mesma janela de tempo real da "noite" (19h do dia `noite` até 04h do dia seguinte).
  const inicio = new Date(`${noite}T16:00:00-03:00`) // margem de 3h antes das 19h, cobre qualquer diferença de fuso na query
  const fim = new Date(`${noite}T04:00:00-03:00`)
  fim.setDate(fim.getDate() + 1)
  fim.setHours(fim.getHours() + 3) // margem de 3h depois das 04h

  const posicoes = await prisma.vehiclePosition.findMany({
    where: { placa, capturedAt: { gte: inicio, lte: fim } },
    select: { latitude: true, longitude: true, capturedAt: true, speedKmh: true },
    orderBy: { capturedAt: 'asc' },
  })

  const filtradas = posicoes.filter((p) => {
    const dia = diaBrasilDe(p.capturedAt)
    const hora = horaBrasilDe(p.capturedAt)
    return classificarNoite(dia, hora) === noite
  })

  const posicoesSimples: PosicaoSimples[] = filtradas.map((p) => ({
    capturedAt: p.capturedAt.toISOString(),
    speedKmh: p.speedKmh,
    lat: p.latitude,
    lng: p.longitude,
  }))

  const segmentos = segmentosRodandoGps(posicoesSimples)
  const pontos = filtradas.map((p, i) => ({
    lat: p.latitude,
    lng: p.longitude,
    capturedAt: p.capturedAt.toISOString(),
    speedKmh: p.speedKmh,
    rodando: i === 0 ? false : segmentos[i - 1].rodando,
  }))

  return NextResponse.json({ pontos })
}
