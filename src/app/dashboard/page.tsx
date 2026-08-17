import Link from 'next/link'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getSessionUser, isAdmin } from '@/lib/authz'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const admin = isAdmin(user)

  const [modules, datasets, lastRuns] = await Promise.all([
    prisma.module.findMany({
      where: admin ? undefined : { userAccesses: { some: { userId: user.id } } },
      orderBy: { phase: 'asc' },
      include: { panels: true },
    }),
    admin ? prisma.dataset.count({ where: { active: true } }) : Promise.resolve(0),
    admin
      ? prisma.syncRun.findMany({
          orderBy: { startedAt: 'desc' },
          take: 5,
          include: { dataset: { select: { name: true } } },
        })
      : Promise.resolve([]),
  ])

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-xl font-semibold">Negócios</h1>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((m) => {
            const card = (
              <div
                className={`rounded-xl border p-4 ${m.active ? 'border-emerald-300 bg-white hover:border-emerald-500' : 'border-slate-200 bg-slate-100 opacity-70'}`}
              >
                <p className="text-xs uppercase tracking-wide text-slate-500">
                  {m.code.startsWith('fase') ? `Fase ${m.phase}` : 'Módulo'}
                </p>
                <h2 className="mt-1 font-medium">{m.name}</h2>
                <p className="mt-2 text-sm text-slate-500">
                  {m.active ? 'Abrir painel →' : 'Não iniciado'}
                </p>
              </div>
            )
            return m.active ? (
              <Link key={m.id} href={`/dashboard/${m.code}`}>{card}</Link>
            ) : (
              <div key={m.id}>{card}</div>
            )
          })}
          {modules.length === 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              Nenhum módulo foi liberado para o seu usuário. Procure um administrador.
            </div>
          )}
        </div>
      </section>

      {admin && <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="font-medium">Fontes de dados</h2>
          <p className="mt-2 text-3xl font-semibold text-emerald-700">{datasets}</p>
          <p className="text-sm text-slate-500">datasets ativos</p>
          <Link href="/dashboard/datasets" className="mt-3 inline-block text-sm text-emerald-700 hover:underline">
            Gerenciar →
          </Link>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="font-medium">Últimas sincronizações</h2>
          {lastRuns.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">Nenhuma sincronização executada ainda.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm">
              {lastRuns.map((r) => (
                <li key={r.id} className="flex justify-between">
                  <span>{r.dataset.name}</span>
                  <span
                    className={
                      r.status === 'SUCCESS'
                        ? 'text-emerald-700'
                        : r.status === 'ERROR'
                          ? 'text-red-600'
                          : 'text-amber-600'
                    }
                  >
                    {r.status === 'SUCCESS' ? `${r.rowsUpserted} linhas` : r.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>}
    </div>
  )
}
