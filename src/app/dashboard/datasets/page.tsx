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
      lastRun: last
        ? {
            status: last.status,
            // Corrigido 2026-09-22 (achado do usuário: "o horario que ele
            // mostra que houve a atualização esta incorreto... 18:07 no
            // entanto ainda são 15:14") — sem `timeZone`, `toLocaleString`
            // usa o fuso do PROCESSO (o container de produção roda em UTC,
            // não Brasília), mesma classe de bug já documentada em
            // src/lib/horario-brasil.ts para outros pontos do sistema.
            startedAt: last.startedAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
            error: last.error,
          }
        : null,
    }
  })

  return <DatasetsTable datasets={items} />
}
