import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { requireResourceEditor, badRequest } from '@/lib/api-helpers'

const updateSchema = z.object({
  precisaRastreamento: z.boolean().optional(),
  codTra: z.string().nullable().optional(),
  ativo: z.boolean().optional(),
  observacoes: z.string().nullable().optional(),
})

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireResourceEditor('veiculos')
  if ('error' in auth) return auth.error
  const { id } = await params
  const parsed = updateSchema.safeParse(await req.json())
  if (!parsed.success) return badRequest(parsed.error.issues.map((i) => i.message).join('; '))

  const vehicle = await prisma.vehicle.update({ where: { id }, data: parsed.data })
  await logAudit({
    userId: auth.user.id,
    userName: auth.user.name,
    action: 'UPDATE',
    entity: 'Vehicle',
    entityId: id,
    details: parsed.data,
  })
  return NextResponse.json(vehicle)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireResourceEditor('veiculos')
  if ('error' in auth) return auth.error
  const { id } = await params
  await prisma.vehicle.delete({ where: { id } })
  await logAudit({
    userId: auth.user.id,
    userName: auth.user.name,
    action: 'DELETE',
    entity: 'Vehicle',
    entityId: id,
  })
  return NextResponse.json({ ok: true })
}
