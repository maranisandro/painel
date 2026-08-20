import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, hasModuleAccess } from '@/lib/authz'
import { prisma } from '@/lib/prisma'

/**
 * Manutenções (motivo de indisponibilidade mecânica) e justificativas de
 * atraso (motivo de baixa eficiência) do ANO selecionado no Painel
 * Estratégico — pedido do usuário 2026-08-20: "preciso entender quais os
 * meus principais motivos de falta de disponibilidade mecanica e
 * eficiencia". Independente do período tático (De/Até), que é só o recorte
 * da aba principal — aqui é sempre o ano inteiro escolhido na aba
 * estratégica.
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser()
  if (!hasModuleAccess(user, 'fase1')) return NextResponse.json({ error: 'acesso negado' }, { status: 403 })

  const ano = req.nextUrl.searchParams.get('ano') ?? String(new Date().getFullYear())
  if (!/^\d{4}$/.test(ano)) return NextResponse.json({ error: 'ano inválido' }, { status: 400 })
  const from = new Date(`${ano}-01-01T00:00:00`)
  const to = new Date(`${ano}-12-31T23:59:59`)

  const [manutencoes, justificativas] = await Promise.all([
    prisma.vehicleMaintenance.findMany({
      where: { startDate: { lte: to }, OR: [{ endDate: null }, { endDate: { gte: from } }] },
      select: { placa: true, startDate: true, endDate: true, motivo: true },
    }),
    // TripJustification não tem data própria (a data está embutida no
    // tripKey, ex.: "2026-08-20|PLACA|MOTORISTA|CLIENTE") — sem filtro de
    // ano aqui; o cliente cruza com `trips` (que já tem DATASAIDA) pra
    // restringir ao ano selecionado.
    prisma.tripJustification.findMany({ select: { tripKey: true, motivo: true } }),
  ])

  return NextResponse.json({
    manutencoes: manutencoes.map((m) => ({
      placa: m.placa,
      startDate: m.startDate.toISOString().slice(0, 10),
      endDate: m.endDate ? m.endDate.toISOString().slice(0, 10) : null,
      motivo: m.motivo ?? '',
    })),
    justificativas: justificativas.map((j) => ({ tripKey: j.tripKey, motivo: j.motivo })),
  })
}
