import { NextRequest, NextResponse } from 'next/server'
import { requireResourceEditor } from '@/lib/api-helpers'
import { reprocessarTicket } from '@/lib/ocr/ingest'

/**
 * Reprocessa um ticket travado/falhado com o motor de OCR atualmente
 * configurado (Cadastros → Tickets de viagem → Motor de OCR) — achado real
 * 2026-08-19/20: subir muitos arquivos de uma vez travava o Tesseract em
 * ~5% pra sempre; a saída é reprocessar com outro motor (ex.: OpenAI).
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireResourceEditor('tickets_viagem')
  if ('error' in auth) return auth.error
  const { id } = await params

  await reprocessarTicket(id, { userId: auth.user.id, userName: auth.user.name })
  return NextResponse.json({ ok: true })
}
