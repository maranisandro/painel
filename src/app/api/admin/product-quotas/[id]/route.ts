import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { requireModuleEditor, badRequest } from '@/lib/api-helpers'

const updateSchema = z.object({
  cotaUnidades: z.number().nonnegative(),
  m3PorUnidade: z.number().nonnegative().nullable().optional(),
})

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireModuleEditor('fase3')
  if ('error' in auth) return auth.error
  const { id } = await params
  const parsed = updateSchema.safeParse(await req.json())
  if (!parsed.success) return badRequest(parsed.error.issues.map((i) => i.message).join('; '))

  const record = await prisma.productQuota.update({
    where: { id },
    data: { cotaUnidades: parsed.data.cotaUnidades, m3PorUnidade: parsed.data.m3PorUnidade },
  })
  await logAudit({
    userId: auth.user.id,
    userName: auth.user.name,
    action: 'UPDATE',
    entity: 'ProductQuota',
    entityId: id,
    details: parsed.data,
  })
  return NextResponse.json(record)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireModuleEditor('fase3')
  if ('error' in auth) return auth.error
  const { id } = await params
  await prisma.productQuota.delete({ where: { id } })
  await logAudit({
    userId: auth.user.id,
    userName: auth.user.name,
    action: 'DELETE',
    entity: 'ProductQuota',
    entityId: id,
  })
  return NextResponse.json({ ok: true })
}
