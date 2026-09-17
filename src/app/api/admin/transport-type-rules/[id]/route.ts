import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { requireResourceEditor, badRequest } from '@/lib/api-helpers'

const updateSchema = z.object({
  tipo: z.string().min(1).optional(),
  prioridade: z.number().int().optional(),
  codtmv: z.string().nullable().optional(),
  produtos: z.string().nullable().optional(),
  origemColigada: z.number().int().nullable().optional(),
  origemFilial: z.number().int().nullable().optional(),
  destinoColigada: z.number().int().nullable().optional(),
  destinoFilial: z.number().int().nullable().optional(),
  ativo: z.boolean().optional(),
})

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireResourceEditor('regras_transporte')
  if ('error' in auth) return auth.error
  const { id } = await params
  const parsed = updateSchema.safeParse(await req.json())
  if (!parsed.success) return badRequest(parsed.error.issues.map((i) => i.message).join('; '))

  let rule
  try {
    rule = await prisma.transportTypeRule.update({ where: { id }, data: parsed.data })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return NextResponse.json({ error: 'não encontrado' }, { status: 404 })
    }
    throw error
  }
  await logAudit({
    userId: auth.user.id,
    userName: auth.user.name,
    action: 'UPDATE',
    entity: 'TransportTypeRule',
    entityId: id,
    details: parsed.data,
  })
  return NextResponse.json(rule)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireResourceEditor('regras_transporte')
  if ('error' in auth) return auth.error
  const { id } = await params
  try {
    await prisma.transportTypeRule.delete({ where: { id } })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return NextResponse.json({ error: 'não encontrado' }, { status: 404 })
    }
    throw error
  }
  await logAudit({
    userId: auth.user.id,
    userName: auth.user.name,
    action: 'DELETE',
    entity: 'TransportTypeRule',
    entityId: id,
  })
  return NextResponse.json({ ok: true })
}
