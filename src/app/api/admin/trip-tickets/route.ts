import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireResourceViewer, requireResourceEditor, badRequest } from '@/lib/api-helpers'
import { ingestTicketFile, TICKET_SELECT } from '@/lib/ocr/ingest'

const MAX_FILE_BYTES = 10 * 1024 * 1024 // 10MB — foto/PDF de ticket de pesagem

export async function GET() {
  const auth = await requireResourceViewer('tickets_viagem')
  if ('error' in auth) return auth.error
  const records = await prisma.tripTicket.findMany({ orderBy: { createdAt: 'desc' }, select: TICKET_SELECT })
  return NextResponse.json(records)
}

// Aceita um ou vários arquivos no mesmo campo "arquivo" (pedido do usuário
// 2026-08-03: "opção de selecionar vários arquivos") — cada um vira um
// ticket próprio, processado (OCR + auto-conciliação) em segundo plano
// independente dos outros.
export async function POST(req: NextRequest) {
  const auth = await requireResourceEditor('tickets_viagem')
  if ('error' in auth) return auth.error

  const form = await req.formData()
  const files = form.getAll('arquivo').filter((f): f is File => f instanceof File)
  if (files.length === 0) return badRequest('Anexe ao menos um arquivo de ticket (foto ou PDF).')
  for (const file of files) {
    if (file.size === 0) return badRequest(`Arquivo "${file.name}" está vazio.`)
    if (file.size > MAX_FILE_BYTES) return badRequest(`Arquivo "${file.name}" maior que 10MB.`)
  }

  const author = { userId: auth.user.id, userName: auth.user.name }
  const created = await Promise.all(
    files.map(async (file) => {
      const buffer = Buffer.from(await file.arrayBuffer())
      return ingestTicketFile(buffer, file.name, file.type || 'application/octet-stream', author)
    }),
  )

  return NextResponse.json(created, { status: 201 })
}
