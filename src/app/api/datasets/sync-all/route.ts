import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionUser, isAdmin } from '@/lib/authz'
import { getPublicSyncError, syncDataset } from '@/lib/sync/engine'
import { logAudit } from '@/lib/audit'

/**
 * Sincroniza TODOS os datasets ativos numa única chamada (um botão só,
 * pedido do usuário 2026-07-29) — em vez de um botão por dataset. Ordem:
 * datasets usados como fonte de LOOKUP por outro dataset (ex.: Transportadoras)
 * sincronizam primeiro, para os demais já lerem o cadastro mais recente.
 */
export async function POST() {
  const user = await getSessionUser()
  if (!isAdmin(user)) {
    return NextResponse.json({ error: 'acesso negado' }, { status: user ? 403 : 401 })
  }

  const [datasets, lookupColumns] = await Promise.all([
    prisma.dataset.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.computedColumn.findMany({ where: { type: 'LOOKUP', active: true } }),
  ])

  const referencedAsLookup = new Set(
    lookupColumns
      .map((c) => (c.rules as { dataset?: string }).dataset)
      .filter((code): code is string => !!code),
  )

  const ordered = [...datasets].sort((a, b) => {
    const aFirst = referencedAsLookup.has(a.code) ? 0 : 1
    const bFirst = referencedAsLookup.has(b.code) ? 0 : 1
    return aFirst - bFirst
  })

  const results: { datasetId: string; name: string; ok: boolean; rowsUpserted?: number; error?: string }[] = []
  for (const dataset of ordered) {
    try {
      const result = await syncDataset(dataset.id)
      results.push({ datasetId: dataset.id, name: dataset.name, ok: true, rowsUpserted: result.rowsUpserted })
    } catch (err) {
      results.push({
        datasetId: dataset.id,
        name: dataset.name,
        ok: false,
        error: getPublicSyncError(err),
      })
    }
  }

  await logAudit({
    userId: user!.id,
    userName: user!.name,
    action: 'SYNC_MANUAL_ALL',
    entity: 'Dataset',
    details: results,
  })

  return NextResponse.json({ results })
}
