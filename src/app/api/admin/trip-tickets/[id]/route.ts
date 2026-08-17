import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { requireResourceEditor } from '@/lib/api-helpers'

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireResourceEditor('tickets_viagem')
  if ('error' in auth) return auth.error
  const { id } = await params
  await prisma.tripTicket.delete({ where: { id } })
  await logAudit({
    userId: auth.user.id,
    userName: auth.user.name,
    action: 'DELETE',
    entity: 'TripTicket',
    entityId: id,
  })
  return NextResponse.json({ ok: true })
}
