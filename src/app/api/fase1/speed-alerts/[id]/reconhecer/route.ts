import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { requireEditor, badRequest } from '@/lib/api-helpers'

const schema = z.object({ motivo: z.string().trim().min(3, 'Descreva o motivo (mínimo 3 caracteres).') })

// Reconhecimento formal — pedido do usuário 2026-08-03: exige um usuário
// logado (auth.user.name, não um dismiss anônimo por navegador) e um motivo,
// ambos gravados no registro para consulta futura ("por que essa placa
// excedeu e quem confirmou estar ciente").
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireEditor()
  if ('error' in auth) return auth.error
  const { id } = await params
  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return badRequest(parsed.error.issues.map((i) => i.message).join('; '))

  const record = await prisma.speedAlert.update({
    where: { id },
    data: { acknowledgedAt: new Date(), acknowledgedBy: auth.user.name, motivo: parsed.data.motivo },
  })
  await logAudit({
    userId: auth.user.id,
    userName: auth.user.name,
    action: 'RECONHECER',
    entity: 'SpeedAlert',
    entityId: id,
    details: parsed.data,
  })
  return NextResponse.json(record)
}
