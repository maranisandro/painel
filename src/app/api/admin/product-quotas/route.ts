import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { requireModuleEditor, requireModuleViewer, badRequest } from '@/lib/api-helpers'

const quotaSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  codigoPrd: z.string().min(1),
  nomeProduto: z.string().nullable().optional(),
  m3PorUnidade: z.number().nonnegative().nullable().optional(),
  cotaUnidades: z.number().nonnegative(),
})

function firstDay(month: string): Date {
  return new Date(`${month}-01T00:00:00`)
}

export async function GET(req: NextRequest) {
  const auth = await requireModuleViewer('fase3')
  if ('error' in auth) return auth.error
  const month = req.nextUrl.searchParams.get('month')
  const records = await prisma.productQuota.findMany({
    where: month ? { month: firstDay(month) } : undefined,
    orderBy: [{ month: 'desc' }, { codigoPrd: 'asc' }],
  })
  return NextResponse.json(records)
}

export async function POST(req: NextRequest) {
  const auth = await requireModuleEditor('fase3')
  if ('error' in auth) return auth.error
  const parsed = quotaSchema.safeParse(await req.json())
  if (!parsed.success) return badRequest(parsed.error.issues.map((i) => i.message).join('; '))

  const { month, codigoPrd, nomeProduto, m3PorUnidade, cotaUnidades } = parsed.data
  const monthDate = firstDay(month)

  const existing = await prisma.productQuota.findUnique({
    where: { month_codigoPrd: { month: monthDate, codigoPrd } },
  })
  if (existing) {
    return badRequest('Já existe uma cota para este produto neste mês — edite o registro existente.')
  }

  const record = await prisma.productQuota.create({
    data: { month: monthDate, codigoPrd, nomeProduto, m3PorUnidade, cotaUnidades },
  })
  await logAudit({
    userId: auth.user.id,
    userName: auth.user.name,
    action: 'CREATE',
    entity: 'ProductQuota',
    entityId: record.id,
    details: parsed.data,
  })
  return NextResponse.json(record, { status: 201 })
}
