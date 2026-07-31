import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { SyncAllButton } from '@/components/SyncAllButton'
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

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Fontes de Dados e Datasets</h1>
        <SyncAllButton />
      </div>
      <p className="mt-1 text-sm text-slate-500">
        Um único botão sincroniza todos os datasets ativos, em ordem: os usados como referência
        (LOOKUP) por outros datasets primeiro (ex.: Transportadoras antes de Vendas com Transporte).
      </p>
      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              <th className="px-4 py-3">Dataset</th>
              <th className="px-4 py-3">Fonte</th>
              <th className="px-4 py-3">Incremental</th>
              <th className="px-4 py-3">Agenda</th>
              <th className="px-4 py-3">Linhas em cache</th>
              <th className="px-4 py-3">Última execução</th>
            </tr>
          </thead>
          <tbody>
            {datasets.map((d) => {
              const last = d.syncRuns[0]
              return (
                <tr key={d.id} className="border-t border-slate-100">
                  <td className="px-4 py-3">
                    <p className="font-medium">{d.name}</p>
                    <p className="text-xs text-slate-500">{d.code}</p>
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs text-emerald-700 hover:underline">
                        Ver consulta
                      </summary>
                      <pre className="mt-1 max-w-md overflow-x-auto whitespace-pre-wrap rounded-md bg-slate-50 p-2 text-[11px] text-slate-700">
                        {d.query}
                      </pre>
                    </details>
                  </td>
                  <td className="px-4 py-3">
                    {d.dataSource.name}
                    <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                      {d.dataSource.type}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {d.incrementalField ? (
                      <span>
                        {d.incrementalField}
                        {d.watermark && (
                          <span className="block text-xs text-slate-500">
                            ≥ {d.watermark.slice(0, 10).split('-').reverse().join('/')}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-slate-400">carga completa</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {d.schedule?.enabled ? `a cada ${d.schedule.intervalMinutes} min` : '—'}
                  </td>
                  <td className="px-4 py-3">{d._count.rows.toLocaleString('pt-BR')}</td>
                  <td className="px-4 py-3">
                    {last ? (
                      <span className={last.status === 'ERROR' ? 'text-red-600' : 'text-emerald-700'}>
                        {last.status}
                        <span className="block text-xs text-slate-500">
                          {last.startedAt.toLocaleString('pt-BR')}
                        </span>
                        {last.status === 'ERROR' && last.error && (
                          <span className="mt-1 block max-w-xs whitespace-normal text-xs text-red-700">
                            {last.error}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-slate-400">nunca</span>
                    )}
                  </td>
                </tr>
              )
            })}
            {datasets.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  Nenhum dataset cadastrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
