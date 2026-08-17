import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { requireModuleEditor, requireModuleViewer, badRequest } from '@/lib/api-helpers'

const quotaSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  codDistribuidor: z.string().min(1),
  nomeDistribuidor: z.string().nullable().optional(),
  metaValor: z.number().nonnegative(),
})

function firstDay(month: string): Date {
  return new Date(`${month}-01T00:00:00`)
}

export async function GET(req: NextRequest) {
  const auth = await requireModuleViewer('fase3')
  if ('error' in auth) return auth.error
  const month = req.nextUrl.searchParams.get('month')
  const records = await prisma.distributorQuota.findMany({
    where: month ? { month: firstDay(month) } : undefined,
    orderBy: [{ month: 'desc' }, { codDistribuidor: 'asc' }],
  })
  return NextResponse.json(records)
}

export async function POST(req: NextRequest) {
  const auth = await requireModuleEditor('fase3')
  if ('error' in auth) return auth.error
  const parsed = quotaSchema.safeParse(await req.json())
  if (!parsed.success) return badRequest(parsed.error.issues.map((i) => i.message).join('; '))

  const { month, codDistribuidor, nomeDistribuidor, metaValor } = parsed.data
  const monthDate = firstDay(month)

  const existing = await prisma.distributorQuota.findUnique({
    where: { month_codDistribuidor: { month: monthDate, codDistribuidor } },
  })
  if (existing) {
    return badRequest('Já existe uma meta para este distribuidor neste mês — edite o registro existente.')
  }

  const record = await prisma.distributorQuota.create({
    data: { month: monthDate, codDistribuidor, nomeDistribuidor, metaValor },
  })
  await logAudit({
    userId: auth.user.id,
    userName: auth.user.name,
    action: 'CREATE',
    entity: 'DistributorQuota',
    entityId: record.id,
    details: parsed.data,
  })
  return NextResponse.json(record, { status: 201 })
}
