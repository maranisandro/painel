import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { requireResourceEditor, badRequest } from '@/lib/api-helpers'

const schema = z.object({
  placa: z.string().min(5).transform((v) => v.trim().toUpperCase()),
  pesoAproximadoTon: z.number().positive(),
  dataTicket: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

// Preenchimento manual dos 3 campos quando o OCR falha (fallback pedido pelo
// usuário 2026-08-03) — depois disso a tela volta a buscar viagens
// candidatas normalmente, como se tivesse vindo do OCR.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireResourceEditor('tickets_viagem')
  if ('error' in auth) return auth.error
  const { id } = await params
  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return badRequest(parsed.error.issues.map((i) => i.message).join('; '))

  const record = await prisma.tripTicket.update({
    where: { id },
    data: {
      placa: parsed.data.placa,
      pesoAproximadoTon: parsed.data.pesoAproximadoTon,
      dataTicket: new Date(`${parsed.data.dataTicket}T00:00:00`),
    },
  })
  await logAudit({
    userId: auth.user.id,
    userName: auth.user.name,
    action: 'PREENCHER_MANUAL',
    entity: 'TripTicket',
    entityId: id,
    details: parsed.data,
  })
  return NextResponse.json(record)
}
