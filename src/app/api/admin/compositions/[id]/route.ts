import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { requireResourceEditor, badRequest } from '@/lib/api-helpers'

const updateSchema = z.object({
  composition: z.string().min(2).optional(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
})

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireResourceEditor('composicoes')
  if ('error' in auth) return auth.error
  const { id } = await params
  const parsed = updateSchema.safeParse(await req.json())
  if (!parsed.success) return badRequest(parsed.error.issues.map((i) => i.message).join('; '))

  const record = await prisma.plateComposition.update({
    where: { id },
    data: {
      composition: parsed.data.composition,
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
    entity: 'PlateComposition',
    entityId: id,
    details: parsed.data,
  })
  return NextResponse.json(record)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireResourceEditor('composicoes')
  if ('error' in auth) return auth.error
  const { id } = await params
  const deleted = await prisma.plateComposition.delete({ where: { id } })
  // `details` grava a placa (pedido do usuário 2026-08-28: ponderar o
  // gráfico "KM médio por placa" pela data em que a placa saiu da
  // estrutura) — antes disso o registro de auditoria só tinha o `id` da
  // composição, que não dá pra recuperar depois de deletado; sem a placa
  // aqui, saídas anteriores a esta correção não são rastreáveis.
  await logAudit({
    userId: auth.user.id,
    userName: auth.user.name,
    action: 'DELETE',
    entity: 'PlateComposition',
    entityId: id,
    details: { placa: deleted.placa, composition: deleted.composition },
  })
  return NextResponse.json({ ok: true })
}
