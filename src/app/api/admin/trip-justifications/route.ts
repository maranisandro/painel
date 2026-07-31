import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { requireEditor, requireModuleViewer, badRequest } from '@/lib/api-helpers'

const justificationSchema = z.object({
  tripKey: z.string().min(1),
  motivo: z.string().min(1),
  // Nova previsão de retorno (opcional) — vazio/ausente = sem previsão revisada
  novaPrevisao: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
})

export async function GET() {
  const auth = await requireModuleViewer('fase1')
  if ('error' in auth) return auth.error
  const records = await prisma.tripJustification.findMany()
  return NextResponse.json(records)
}

// Upsert por tripKey: uma viagem tem no máximo uma justificativa, editar
// substitui o motivo anterior em vez de criar um registro novo.
export async function POST(req: NextRequest) {
  const auth = await requireEditor()
  if ('error' in auth) return auth.error
  const parsed = justificationSchema.safeParse(await req.json())
  if (!parsed.success) return badRequest(parsed.error.issues.map((i) => i.message).join('; '))

  const { tripKey, motivo, novaPrevisao } = parsed.data
  const novaPrevisaoDate = novaPrevisao ? new Date(`${novaPrevisao}T00:00:00`) : null
  const record = await prisma.tripJustification.upsert({
    where: { tripKey },
    create: { tripKey, motivo, novaPrevisao: novaPrevisaoDate },
    update: { motivo, novaPrevisao: novaPrevisaoDate },
  })
  await logAudit({
    userId: auth.user.id,
    userName: auth.user.name,
    action: 'UPSERT',
    entity: 'TripJustification',
    entityId: record.id,
    details: parsed.data,
  })
  return NextResponse.json(record, { status: 201 })
}
