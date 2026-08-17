import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { requireModuleEditor, requireModuleViewer, badRequest } from '@/lib/api-helpers'

const settingsSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/), // "2026-08"
  metaVolumeM3: z.number().positive(),
  icms7Pct: z.number().min(0).max(100),
  icms12Pct: z.number().min(0).max(100),
  icms18Pct: z.number().min(0).max(100),
})

function firstDay(month: string): Date {
  return new Date(`${month}-01T00:00:00`)
}

export async function GET(req: NextRequest) {
  const auth = await requireModuleViewer('fase3')
  if ('error' in auth) return auth.error
  const month = req.nextUrl.searchParams.get('month')
  const records = await prisma.monthlyQuotaSettings.findMany({
    where: month ? { month: firstDay(month) } : undefined,
    orderBy: { month: 'desc' },
  })
  return NextResponse.json(records)
}

// Upsert por mês — pedido do usuário 2026-08-12: cadastro mensal ajustável,
// um registro por mês (não histórico de mudanças tipo effectiveFrom).
export async function POST(req: NextRequest) {
  const auth = await requireModuleEditor('fase3')
  if ('error' in auth) return auth.error
  const parsed = settingsSchema.safeParse(await req.json())
  if (!parsed.success) return badRequest(parsed.error.issues.map((i) => i.message).join('; '))

  const { month, metaVolumeM3, icms7Pct, icms12Pct, icms18Pct } = parsed.data
  const somaIcms = icms7Pct + icms12Pct + icms18Pct
  if (Math.abs(somaIcms - 100) > 0.1) {
    return badRequest(`As 3 faixas de ICMS devem somar 100% (soma atual: ${somaIcms}%).`)
  }

  const monthDate = firstDay(month)
  const record = await prisma.monthlyQuotaSettings.upsert({
    where: { month: monthDate },
    update: { metaVolumeM3, icms7Pct, icms12Pct, icms18Pct },
    create: { month: monthDate, metaVolumeM3, icms7Pct, icms12Pct, icms18Pct },
  })
  await logAudit({
    userId: auth.user.id,
    userName: auth.user.name,
    action: 'UPSERT',
    entity: 'MonthlyQuotaSettings',
    entityId: record.id,
    details: parsed.data,
  })
  return NextResponse.json(record, { status: 201 })
}
