import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { requireResourceEditor, badRequest } from '@/lib/api-helpers'

const updateSchema = z.object({
  composition: z.string().min(2).optional(),
  numEixos: z.string().nullable().optional(),
  pbtcMaximoTon: z.number().positive().nullable().optional(),
  taraMinTon: z.number().positive().nullable().optional(),
  taraMaxTon: z.number().positive().nullable().optional(),
  cargaLiquidaMinTon: z.number().positive().nullable().optional(),
  cargaLiquidaMaxTon: z.number().positive().nullable().optional(),
  active: z.boolean().optional(),
})

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireResourceEditor('composicoes')
  if ('error' in auth) return auth.error
  const { id } = await params
  const parsed = updateSchema.safeParse(await req.json())
  if (!parsed.success) return badRequest(parsed.error.issues.map((i) => i.message).join('; '))

  const spec = await prisma.compositionSpec.update({ where: { id }, data: parsed.data })
  await logAudit({
    userId: auth.user.id,
    userName: auth.user.name,
    action: 'UPDATE',
    entity: 'CompositionSpec',
    entityId: id,
    details: parsed.data,
  })
  return NextResponse.json(spec)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireResourceEditor('composicoes')
  if ('error' in auth) return auth.error
  const { id } = await params
  await prisma.compositionSpec.delete({ where: { id } })
  await logAudit({
    userId: auth.user.id,
    userName: auth.user.name,
    action: 'DELETE',
    entity: 'CompositionSpec',
    entityId: id,
  })
  return NextResponse.json({ ok: true })
}
