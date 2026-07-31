import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { requireEditor } from '@/lib/api-helpers'

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireEditor()
  if ('error' in auth) return auth.error
  const { id } = await params
  await prisma.tripJustification.delete({ where: { id } })
  await logAudit({
    userId: auth.user.id,
    userName: auth.user.name,
    action: 'DELETE',
    entity: 'TripJustification',
    entityId: id,
  })
  return NextResponse.json({ ok: true })
}
