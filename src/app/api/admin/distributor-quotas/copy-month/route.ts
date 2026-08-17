import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { requireModuleEditor, badRequest } from '@/lib/api-helpers'

const bodySchema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) })

function firstDay(month: string): Date {
  return new Date(`${month}-01T00:00:00`)
}

// Copia as metas do mês anterior mais recente com dado — pedido do usuário
// 2026-08-12: "podem ser ajustadas a cada mês", ou seja, na maioria dos
// meses o valor só repete o anterior. Só copia se o mês de destino ainda
// não tiver nenhuma meta (não sobrescreve ajuste já feito).
export async function POST(req: NextRequest) {
  const auth = await requireModuleEditor('fase3')
  if ('error' in auth) return auth.error
  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) return badRequest(parsed.error.issues.map((i) => i.message).join('; '))

  const monthDate = firstDay(parsed.data.month)
  const existing = await prisma.distributorQuota.count({ where: { month: monthDate } })
  if (existing > 0) return badRequest('Este mês já tem metas cadastradas — apague antes de copiar de novo.')

  const previous = await prisma.distributorQuota.findMany({
    where: { month: { lt: monthDate } },
    orderBy: { month: 'desc' },
    take: 1000,
  })
  const lastMonthTime = previous[0]?.month?.getTime()
  const toCopy = previous.filter((p) => p.month.getTime() === lastMonthTime)
  if (toCopy.length === 0) return NextResponse.json({ copiados: 0 })

  await prisma.distributorQuota.createMany({
    data: toCopy.map((p) => ({
      month: monthDate,
      codDistribuidor: p.codDistribuidor,
      nomeDistribuidor: p.nomeDistribuidor,
      metaValor: p.metaValor,
    })),
  })
  await logAudit({
    userId: auth.user.id,
    userName: auth.user.name,
    action: 'COPY_MONTH',
    entity: 'DistributorQuota',
    details: { month: parsed.data.month, copiados: toCopy.length },
  })
  return NextResponse.json({ copiados: toCopy.length })
}
