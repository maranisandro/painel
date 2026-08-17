import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireResourceEditor } from '@/lib/api-helpers'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireResourceEditor('tickets_viagem')
  if ('error' in auth) return auth.error
  const { id } = await params
  const ticket = await prisma.tripTicket.findUnique({
    where: { id },
    select: { fileData: true, fileMime: true, fileName: true },
  })
  if (!ticket) return NextResponse.json({ error: 'ticket não encontrado' }, { status: 404 })

  return new NextResponse(new Uint8Array(ticket.fileData), {
    headers: {
      'Content-Type': ticket.fileMime,
      'Content-Disposition': `inline; filename="${encodeURIComponent(ticket.fileName)}"`,
      'Cache-Control': 'private, max-age=3600',
    },
  })
}
