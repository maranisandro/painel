import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireResourceEditor } from '@/lib/api-helpers'
import { reprocessarTicket } from '@/lib/ocr/ingest'

// Tickets em "processando" há mais tempo que isso não estão mais rodando de
// verdade — travaram (achado real 2026-08-19/20: Tesseract concorrente
// demais trava em ~5% pra sempre, sem erro). Reprocessa todos de uma vez,
// já protegido pela fila de concorrência limitada (enfileirarOcr).
const LIMIAR_TRAVADO_MINUTOS = 10

export async function POST() {
  const auth = await requireResourceEditor('tickets_viagem')
  if ('error' in auth) return auth.error

  const limite = new Date(Date.now() - LIMIAR_TRAVADO_MINUTOS * 60_000)
  const travados = await prisma.tripTicket.findMany({
    where: { ocrStatus: 'processando', createdAt: { lt: limite } },
    select: { id: true },
  })

  for (const t of travados) {
    await reprocessarTicket(t.id, { userId: auth.user.id, userName: auth.user.name })
  }

  return NextResponse.json({ reprocessados: travados.length })
}
