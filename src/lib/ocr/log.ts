import { prisma } from '@/lib/prisma'

/** Acrescenta uma linha ao log do ticket e, se informado, atualiza o % de progresso. Nunca lança. */
export async function appendOcrLog(ticketId: string, linha: string, progress?: number): Promise<void> {
  const hora = new Date().toLocaleTimeString('pt-BR')
  try {
    await prisma.tripTicket.update({
      where: { id: ticketId },
      data: {
        ocrLog: { push: `${hora} — ${linha}` },
        ...(progress != null ? { ocrProgress: Math.max(0, Math.min(100, Math.round(progress))) } : {}),
      },
    })
  } catch (err) {
    console.error('[ocr] falha ao gravar log', err)
  }
}
