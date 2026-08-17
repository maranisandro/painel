import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { requireResourceEditor, badRequest } from '@/lib/api-helpers'

// tripKeys vazio = desfazer a conciliação (volta para pendente). Um ticket
// pode cobrir mais de uma nota/viagem — pedido do usuário 2026-08-03
// ("opção de selecionar várias notas").
const schema = z.object({ tripKeys: z.array(z.string().min(1)) })

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireResourceEditor('tickets_viagem')
  if ('error' in auth) return auth.error
  const { id } = await params
  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return badRequest(parsed.error.issues.map((i) => i.message).join('; '))

  const { tripKeys } = parsed.data
  const record = await prisma.tripTicket.update({
    where: { id },
    data:
      tripKeys.length > 0
        ? { matchedTripKeys: tripKeys, conferidoEm: new Date(), conferidoPor: auth.user.name }
        : { matchedTripKeys: [], conferidoEm: null, conferidoPor: null },
    select: {
      id: true,
      placa: true,
      pesoAproximadoTon: true,
      dataTicket: true,
      fileName: true,
      fileMime: true,
      matchedTripKeys: true,
      conferidoEm: true,
      conferidoPor: true,
      createdAt: true,
    },
  })
  await logAudit({
    userId: auth.user.id,
    userName: auth.user.name,
    action: tripKeys.length > 0 ? 'CONCILIAR' : 'DESFAZER_CONCILIACAO',
    entity: 'TripTicket',
    entityId: id,
    details: parsed.data,
  })
  return NextResponse.json(record)
}
