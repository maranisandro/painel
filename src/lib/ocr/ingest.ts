import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { getAllTripsBasic } from '@/lib/fase1/get-trips-simple'
import { recognizeTicket, type OcrOutcome } from './index'
import { appendOcrLog } from './log'
import { enfileirarOcr } from './queue'
import type { OcrLogFn } from './types'

// Achado real 2026-08-19/20: um Tesseract travado nunca resolve nem rejeita
// — sem timeout, ocuparia pra sempre uma das vagas da fila de concorrência
// limitada (`enfileirarOcr`), entupindo o processamento de todo mundo atrás.
const OCR_TIMEOUT_MS = 90_000

async function recognizeTicketComTimeout(
  fileBuffer: Buffer,
  mime: string,
  onLog: OcrLogFn,
): Promise<OcrOutcome> {
  return Promise.race([
    recognizeTicket(fileBuffer, mime, onLog),
    new Promise<OcrOutcome>((resolve) => {
      setTimeout(() => {
        onLog('OCR não respondeu em 90s — marcando como falha, preencha manualmente.', 100)
        resolve({ status: 'falhou', placa: null, pesoAproximadoTon: null, dataTicket: null, textoBruto: null })
      }, OCR_TIMEOUT_MS)
    }),
  ])
}

// Tolerância para conciliar sozinho: peso do ticket muito próximo do peso
// líquido da viagem (a NF já soma o peso de todas as notas do agrupamento).
const AUTO_MATCH_TOLERANCIA_TON = 2

export interface IngestAuthor {
  userId: string | null
  userName: string | null
}

export const TICKET_SELECT = {
  id: true,
  placa: true,
  pesoAproximadoTon: true,
  dataTicket: true,
  fileName: true,
  fileMime: true,
  ocrStatus: true,
  ocrTexto: true,
  ocrLog: true,
  ocrProgress: true,
  matchedTripKeys: true,
  conferidoEm: true,
  conferidoPor: true,
  createdAt: true,
} as const

/**
 * Cria o ticket e devolve na hora (ocrStatus "processando") — o OCR roda
 * depois, em segundo plano, sem travar quem chamou (upload HTTP ou vigia de
 * pasta). Pipeline único usado pelos dois pontos de entrada (pedido do
 * usuário 2026-08-03: "trabalhar com o upload e reconhecimento em segundo
 * plano", depois estendido para múltiplos arquivos e vigia de pasta).
 */
export async function ingestTicketFile(fileBuffer: Buffer, fileName: string, mime: string, author: IngestAuthor) {
  const created = await prisma.tripTicket.create({
    data: {
      fileName,
      fileMime: mime,
      fileData: new Uint8Array(fileBuffer),
      ocrStatus: 'processando',
      ocrLog: ['Ticket recebido, iniciando OCR em segundo plano…'],
    },
    select: TICKET_SELECT,
  })
  await logAudit({
    userId: author.userId,
    userName: author.userName,
    action: 'UPLOAD',
    entity: 'TripTicket',
    entityId: created.id,
    details: { fileName },
  })

  processarEmSegundoPlano(created.id, fileBuffer, mime, author).catch((err) =>
    console.error('[trip-tickets] falha no processamento em segundo plano', err),
  )

  return created
}

/**
 * Reprocessa um ticket já existente (ex.: preso em "processando" desde um
 * travamento anterior, ou "falhou" que o usuário quer tentar de novo com
 * outro motor de OCR) — busca o arquivo já salvo no banco, zera o log/status
 * e roda o mesmo pipeline de `ingestTicketFile`, sem duplicar o upload.
 */
export async function reprocessarTicket(ticketId: string, author: IngestAuthor) {
  const ticket = await prisma.tripTicket.findUniqueOrThrow({
    where: { id: ticketId },
    select: { fileData: true, fileMime: true },
  })
  await prisma.tripTicket.update({
    where: { id: ticketId },
    data: { ocrStatus: 'processando', ocrLog: ['Reprocessando…'], ocrProgress: 0 },
  })
  processarEmSegundoPlano(ticketId, Buffer.from(ticket.fileData), ticket.fileMime, author).catch((err) =>
    console.error('[trip-tickets] falha ao reprocessar', err),
  )
}

async function processarEmSegundoPlano(ticketId: string, fileBuffer: Buffer, mime: string, author: IngestAuthor) {
  const onLog: OcrLogFn = (msg, progress) => {
    void appendOcrLog(ticketId, msg, progress)
  }
  const ocr = await enfileirarOcr(() => recognizeTicketComTimeout(fileBuffer, mime, onLog))

  const updated = await prisma.tripTicket.update({
    where: { id: ticketId },
    data: {
      placa: ocr.placa,
      pesoAproximadoTon: ocr.pesoAproximadoTon,
      dataTicket: ocr.dataTicket ? new Date(`${ocr.dataTicket}T00:00:00`) : null,
      ocrStatus: ocr.status,
      ocrTexto: ocr.textoBruto,
    },
  })
  await logAudit({
    userId: author.userId,
    userName: author.userName,
    action: 'OCR_CONCLUIDO',
    entity: 'TripTicket',
    entityId: ticketId,
    details: { ocrStatus: ocr.status, placa: ocr.placa },
  })

  if (ocr.status !== 'reconhecido' || !updated.placa || updated.pesoAproximadoTon == null) return

  onLog('Buscando viagens candidatas para conciliar automaticamente…')
  const trips = await getAllTripsBasic()
  const normPlaca = updated.placa.trim().toUpperCase()
  const pesoTicket = Number(updated.pesoAproximadoTon)
  const candidatos = trips
    .filter((t) => String(t.PLACA ?? '').trim().toUpperCase() === normPlaca)
    .map((t) => ({
      tripKey: String(t.VIAGEM_KEY ?? ''),
      diff: Math.abs((Number(t.PESOLIQUIDO) || 0) / 1000 - pesoTicket),
    }))
    .sort((a, b) => a.diff - b.diff)

  if (candidatos.length === 0) {
    onLog('Nenhuma viagem desta placa encontrada — fica pendente para conciliação manual.')
    return
  }
  if (candidatos[0].diff > AUTO_MATCH_TOLERANCIA_TON) {
    onLog(
      `Melhor candidata com diferença de ${candidatos[0].diff.toFixed(1)} t — acima da tolerância, fica pendente para escolha manual.`,
    )
    return
  }

  await prisma.tripTicket.update({
    where: { id: ticketId },
    data: { matchedTripKeys: [candidatos[0].tripKey], conferidoEm: new Date(), conferidoPor: 'OCR automático' },
  })
  onLog(`Conciliado automaticamente (diferença de ${candidatos[0].diff.toFixed(1)} t).`)
  await logAudit({
    userId: author.userId,
    userName: author.userName,
    action: 'CONCILIAR_AUTOMATICO',
    entity: 'TripTicket',
    entityId: ticketId,
    details: { tripKey: candidatos[0].tripKey, diffTon: candidatos[0].diff },
  })
}
