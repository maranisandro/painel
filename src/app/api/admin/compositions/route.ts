import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { requireResourceViewer, requireResourceEditor, badRequest } from '@/lib/api-helpers'

const compositionSchema = z.object({
  placa: z.string().min(5).transform((v) => v.trim().toUpperCase()),
  composition: z.string().min(2),
  // null = composição de cadastro (vale desde sempre até a primeira mudança)
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
})

export async function GET() {
  const auth = await requireResourceViewer('composicoes')
  if ('error' in auth) return auth.error
  const records = await prisma.plateComposition.findMany({
    orderBy: [{ placa: 'asc' }, { effectiveFrom: 'asc' }],
  })
  return NextResponse.json(records)
}

export async function POST(req: NextRequest) {
  const auth = await requireResourceEditor('composicoes')
  if ('error' in auth) return auth.error
  const parsed = compositionSchema.safeParse(await req.json())
  if (!parsed.success) return badRequest(parsed.error.issues.map((i) => i.message).join('; '))

  const { placa, composition, effectiveFrom } = parsed.data

  // Só pode existir UMA composição de cadastro (sem data) por placa
  if (!effectiveFrom) {
    const existingBase = await prisma.plateComposition.findFirst({
      where: { placa, effectiveFrom: null },
    })
    if (existingBase) {
      return badRequest(
        'Esta placa já tem composição de cadastro — para trocar o implemento, registre uma mudança com data.',
      )
    }
  } else {
    const sameDate = await prisma.plateComposition.findFirst({
      where: { placa, effectiveFrom: new Date(`${effectiveFrom}T00:00:00`) },
    })
    if (sameDate) return badRequest('Já existe uma mudança nesta data para esta placa.')
  }

  const record = await prisma.plateComposition.create({
    data: {
      placa,
      composition,
      effectiveFrom: effectiveFrom ? new Date(`${effectiveFrom}T00:00:00`) : null,
    },
  })
  await logAudit({
    userId: auth.user.id,
    userName: auth.user.name,
    action: 'CREATE',
    entity: 'PlateComposition',
    entityId: record.id,
    details: parsed.data,
  })
  return NextResponse.json(record, { status: 201 })
}
