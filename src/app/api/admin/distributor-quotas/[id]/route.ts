import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { requireModuleEditor, badRequest } from '@/lib/api-helpers'

const updateSchema = z.object({
  metaValor: z.number().nonnegative(),
  // Nome de exibição opcional — pedido do usuário 2026-08-13: quando o
  // código do distribuidor não bate com nenhum cliente do cadastro (ex.
  // "C99999999", um código placeholder usado na importação), o nome
  // precisa poder ser corrigido manualmente pela tela.
  nomeDistribuidor: z.string().trim().min(1).nullable().optional(),
})

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireModuleEditor('fase3')
  if ('error' in auth) return auth.error
  const { id } = await params
  const parsed = updateSchema.safeParse(await req.json())
  if (!parsed.success) return badRequest(parsed.error.issues.map((i) => i.message).join('; '))

  const record = await prisma.distributorQuota.update({
    where: { id },
    data: {
      metaValor: parsed.data.metaValor,
      ...(parsed.data.nomeDistribuidor !== undefined ? { nomeDistribuidor: parsed.data.nomeDistribuidor } : {}),
    },
  })
  await logAudit({
    userId: auth.user.id,
    userName: auth.user.name,
    action: 'UPDATE',
    entity: 'DistributorQuota',
    entityId: id,
    details: parsed.data,
  })
  return NextResponse.json(record)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireModuleEditor('fase3')
  if ('error' in auth) return auth.error
  const { id } = await params
  await prisma.distributorQuota.delete({ where: { id } })
  await logAudit({
    userId: auth.user.id,
    userName: auth.user.name,
    action: 'DELETE',
    entity: 'DistributorQuota',
    entityId: id,
  })
  return NextResponse.json({ ok: true })
}
