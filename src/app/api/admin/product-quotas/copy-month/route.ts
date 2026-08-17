import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { requireModuleEditor, badRequest } from '@/lib/api-helpers'

const bodySchema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) })

function firstDay(month: string): Date {
  return new Date(`${month}-01T00:00:00`)
}

export async function POST(req: NextRequest) {
  const auth = await requireModuleEditor('fase3')
  if ('error' in auth) return auth.error
  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) return badRequest(parsed.error.issues.map((i) => i.message).join('; '))

  const monthDate = firstDay(parsed.data.month)
  const existing = await prisma.productQuota.count({ where: { month: monthDate } })
  if (existing > 0) return badRequest('Este mês já tem cotas cadastradas — apague antes de copiar de novo.')

  const previous = await prisma.productQuota.findMany({
    where: { month: { lt: monthDate } },
    orderBy: { month: 'desc' },
    take: 5000,
  })
  const lastMonthTime = previous[0]?.month?.getTime()
  const toCopy = previous.filter((p) => p.month.getTime() === lastMonthTime)
  if (toCopy.length === 0) return NextResponse.json({ copiados: 0 })

  await prisma.productQuota.createMany({
    data: toCopy.map((p) => ({
      month: monthDate,
      codigoPrd: p.codigoPrd,
      nomeProduto: p.nomeProduto,
      m3PorUnidade: p.m3PorUnidade,
      cotaUnidades: p.cotaUnidades,
    })),
  })
  await logAudit({
    userId: auth.user.id,
    userName: auth.user.name,
    action: 'COPY_MONTH',
    entity: 'ProductQuota',
    details: { month: parsed.data.month, copiados: toCopy.length },
  })
  return NextResponse.json({ copiados: toCopy.length })
}
