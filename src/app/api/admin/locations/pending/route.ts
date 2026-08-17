import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireResourceEditor } from '@/lib/api-helpers'

/**
 * Unidades (coligada/filial) presentes nos dados sincronizados da Fase 1 que
 * ainda não têm Local cadastrado — para o usuário criar novos cadastros com
 * nome amigável à medida que aparecerem (o nome real vem do ERP).
 */
export async function GET() {
  const auth = await requireResourceEditor('locais')
  if ('error' in auth) return auth.error

  const dataset = await prisma.dataset.findUnique({ where: { code: 'fase1_vendas_transporte' } })
  if (!dataset) return NextResponse.json([])

  const [rows, locations] = await Promise.all([
    prisma.datasetRow.findMany({ where: { datasetId: dataset.id }, select: { data: true } }),
    prisma.location.findMany({ where: { type: 'UNIDADE', active: true } }),
  ])

  const matched = (coligada: number, filial: number) =>
    locations.some(
      (l) =>
        l.matchColigada !== null &&
        l.matchColigada === coligada &&
        (l.matchFilial === null || l.matchFilial === filial),
    )

  const pending = new Map<string, { coligada: number; filial: number; nomeReal: string; viagens: number }>()
  for (const r of rows) {
    const data = r.data as Record<string, unknown>
    const coligada = Number(data.CODCOLIGADA)
    const filial = Number(data.CODFILIAL)
    if (!Number.isFinite(coligada) || !Number.isFinite(filial)) continue
    if (matched(coligada, filial)) continue
    const key = `${coligada}/${filial}`
    const entry = pending.get(key)
    if (entry) entry.viagens += 1
    else
      pending.set(key, {
        coligada,
        filial,
        nomeReal: String(data.NOME_FILIAL ?? '').trim(),
        viagens: 1,
      })
  }

  return NextResponse.json(
    [...pending.values()].sort((a, b) => b.viagens - a.viagens),
  )
}
