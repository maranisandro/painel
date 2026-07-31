import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, isAdmin } from '@/lib/authz'
import { getPublicSyncError, syncDataset } from '@/lib/sync/engine'
import { logAudit } from '@/lib/audit'

/** Sincronização manual de um dataset (somente administrador). */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!isAdmin(user)) {
    return NextResponse.json({ error: 'acesso negado' }, { status: user ? 403 : 401 })
  }

  const { id } = await params
  try {
    const result = await syncDataset(id)
    await logAudit({
      userId: user!.id,
      userName: user!.name,
      action: 'SYNC_MANUAL',
      entity: 'Dataset',
      entityId: id,
      details: result,
    })
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json(
      { error: getPublicSyncError(err) },
      { status: 500 },
    )
  }
}
