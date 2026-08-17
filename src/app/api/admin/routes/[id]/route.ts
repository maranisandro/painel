import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { requireResourceEditor, badRequest } from '@/lib/api-helpers'

const updateSchema = z.object({
  originId: z.string().uuid().optional(),
  destinationId: z.string().uuid().optional(),
  distanceAsphaltKm: z.number().min(0).optional(),
  distanceDirtKm: z.number().min(0).optional(),
  speedLoadedKmh: z.number().positive().nullable().optional(),
  speedEmptyKmh: z.number().positive().nullable().optional(),
  loadMinutes: z.number().int().min(0).nullable().optional(),
  unloadMinutes: z.number().int().min(0).nullable().optional(),
  expectedRoundTripDays: z.number().positive().nullable().optional(),
  fixedComposition: z.string().nullable().optional(),
  active: z.boolean().optional(),
})

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireResourceEditor('rotas')
  if ('error' in auth) return auth.error
  const { id } = await params
  const parsed = updateSchema.safeParse(await req.json())
  if (!parsed.success) return badRequest(parsed.error.issues.map((i) => i.message).join('; '))

  const route = await prisma.route.update({
    where: { id },
    data: parsed.data,
    include: { origin: true, destination: true },
  })
  await logAudit({
    userId: auth.user.id,
    userName: auth.user.name,
    action: 'UPDATE',
    entity: 'Route',
    entityId: id,
    details: parsed.data,
  })
  return NextResponse.json(route)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireResourceEditor('rotas')
  if ('error' in auth) return auth.error
  const { id } = await params
  await prisma.route.delete({ where: { id } })
  await logAudit({
    userId: auth.user.id,
    userName: auth.user.name,
    action: 'DELETE',
    entity: 'Route',
    entityId: id,
  })
  return NextResponse.json({ ok: true })
}
