import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { DatasetsTable } from '@/components/DatasetsTable'
import { getSessionUser, isAdmin } from '@/lib/authz'

export const dynamic = 'force-dynamic'

export default async function DatasetsPage() {
  const user = await getSessionUser()
  if (!isAdmin(user)) redirect('/dashboard')

  const datasets = await prisma.dataset.findMany({
    include: {
      dataSource: true,
      schedule: true,
      syncRuns: { orderBy: { startedAt: 'desc' }, take: 1 },
      _count: { select: { rows: true } },
    },
    orderBy: { name: 'asc' },
  })

  const items = datasets.map((d) => {
    const last = d.syncRuns[0]
    return {
      id: d.id,
      name: d.name,
      code: d.code,
      query: d.query,
      dataSourceName: d.dataSource.name,
      dataSourceType: d.dataSource.type,
      incrementalField: d.incrementalField,
      watermark: d.watermark,
      intervalMinutes: d.schedule?.intervalMinutes ?? null,
      scheduleEnabled: d.schedule?.enabled ?? false,
      rowsCount: d._count.rows,
      lastRun: last ? { status: last.status, startedAt: last.startedAt.toLocaleString('pt-BR'), error: last.error } : null,
    }
  })

  return <DatasetsTable datasets={items} />
}
