import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { requireEditor, badRequest } from '@/lib/api-helpers'

const schema = z.object({
  antesDe: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (YYYY-MM-DD)'),
  motivo: z.string().trim().min(3, 'Descreva o motivo (mínimo 3 caracteres).'),
})

/**
 * Reconhecimento em lote de excessos de velocidade antigos — pedido do
 * usuário 2026-08-19: "limpar o excesso de velocidade anterior a 17/08 para
 * acompanhamento". Não apaga nada (mantém o histórico) — só marca como
 * reconhecido tudo que ainda estava em aberto antes da data informada, pra
 * tirar da lista de pendências sem perder o registro.
 */
export async function POST(req: NextRequest) {
  const auth = await requireEditor()
  if ('error' in auth) return auth.error
  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return badRequest(parsed.error.issues.map((i) => i.message).join('; '))

  const { antesDe, motivo } = parsed.data
  const cutoff = new Date(`${antesDe}T00:00:00Z`)

  const result = await prisma.speedAlert.updateMany({
    where: { acknowledgedAt: null, capturedAt: { lt: cutoff } },
    data: { acknowledgedAt: new Date(), acknowledgedBy: auth.user.name, motivo },
  })

  await logAudit({
    userId: auth.user.id,
    userName: auth.user.name,
    action: 'RECONHECER_LOTE',
    entity: 'SpeedAlert',
    details: { antesDe, motivo, quantidade: result.count },
  })

  return NextResponse.json({ quantidade: result.count })
}
