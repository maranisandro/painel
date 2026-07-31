import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { requireEditor, badRequest } from '@/lib/api-helpers'

const priceSchema = z.object({
  routeId: z.string().uuid(),
  valorReferencia: z.number().positive(),
  unidade: z.enum(['KM', 'TONELADA', 'MDC', 'M3']).default('TONELADA'),
  // null = cadastro inicial (vale desde sempre até a primeira mudança)
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
})

export async function GET() {
  const auth = await requireEditor()
  if ('error' in auth) return auth.error
  const records = await prisma.routeFreightPrice.findMany({
    include: { route: { include: { origin: true, destination: true } } },
    orderBy: [{ routeId: 'asc' }, { effectiveFrom: 'asc' }],
  })
  return NextResponse.json(records)
}

export async function POST(req: NextRequest) {
  const auth = await requireEditor()
  if ('error' in auth) return auth.error
  const parsed = priceSchema.safeParse(await req.json())
  if (!parsed.success) return badRequest(parsed.error.issues.map((i) => i.message).join('; '))

  const { routeId, valorReferencia, unidade, effectiveFrom } = parsed.data

  // Só pode existir UM cadastro (sem data) por rota
  if (!effectiveFrom) {
    const existingBase = await prisma.routeFreightPrice.findFirst({
      where: { routeId, effectiveFrom: null },
    })
    if (existingBase) {
      return badRequest(
        'Esta rota já tem valor de cadastro — para trocar o preço, registre uma mudança com data.',
      )
    }
  } else {
    const sameDate = await prisma.routeFreightPrice.findFirst({
      where: { routeId, effectiveFrom: new Date(`${effectiveFrom}T00:00:00`) },
    })
    if (sameDate) return badRequest('Já existe uma mudança nesta data para esta rota.')
  }

  const record = await prisma.routeFreightPrice.create({
    data: {
      routeId,
      valorReferencia,
      unidade,
      effectiveFrom: effectiveFrom ? new Date(`${effectiveFrom}T00:00:00`) : null,
    },
  })
  await logAudit({
    userId: auth.user.id,
    userName: auth.user.name,
    action: 'CREATE',
    entity: 'RouteFreightPrice',
    entityId: record.id,
    details: parsed.data,
  })
  return NextResponse.json(record, { status: 201 })
}
