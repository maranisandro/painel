import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { requireEditor, badRequest } from '@/lib/api-helpers'

const updateSchema = z.object({
  valorReferencia: z.number().positive().optional(),
  unidade: z.enum(['KM', 'TONELADA', 'MDC', 'M3']).optional(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
})

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireEditor()
  if ('error' in auth) return auth.error
  const { id } = await params
  const parsed = updateSchema.safeParse(await req.json())
  if (!parsed.success) return badRequest(parsed.error.issues.map((i) => i.message).join('; '))

  const record = await prisma.routeFreightPrice.update({
    where: { id },
    data: {
      valorReferencia: parsed.data.valorReferencia,
      unidade: parsed.data.unidade,
      effectiveFrom:
        parsed.data.effectiveFrom === undefined
          ? undefined
          : parsed.data.effectiveFrom === null
            ? null
            : new Date(`${parsed.data.effectiveFrom}T00:00:00`),
    },
  })
  await logAudit({
    userId: auth.user.id,
    userName: auth.user.name,
    action: 'UPDATE',
    entity: 'RouteFreightPrice',
    entityId: id,
    details: parsed.data,
  })
  return NextResponse.json(record)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireEditor()
  if ('error' in auth) return auth.error
  const { id } = await params
  await prisma.routeFreightPrice.delete({ where: { id } })
  await logAudit({
    userId: auth.user.id,
    userName: auth.user.name,
    action: 'DELETE',
    entity: 'RouteFreightPrice',
    entityId: id,
  })
  return NextResponse.json({ ok: true })
}
