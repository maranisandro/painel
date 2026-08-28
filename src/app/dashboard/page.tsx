import Link from 'next/link'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getSessionUser, isAdmin } from '@/lib/authz'
import { Card } from '@/components/shared/ui/Card'
import { SectionHeading } from '@/components/shared/ui/SectionHeading'
import { StatTile } from '@/components/shared/ui/StatTile'
import { Badge } from '@/components/shared/ui/Badge'
import { Callout } from '@/components/shared/ui/Callout'
import { moduleIcon } from '@/components/shared/ui/icons'

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

  const producao = process.env.NEXT_PUBLIC_APP_ENV === 'producao'

  return (
    <div className="space-y-8">
      <Callout tone={producao ? 'danger' : 'info'} title={producao ? 'PRODUÇÃO' : 'DEV'}>
        <span className="font-mono opacity-80">{process.env.NEXT_PUBLIC_BUILD_VERSION ?? 'sem versão'}</span>
      </Callout>

      <section>
        <SectionHeading>Negócios</SectionHeading>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((m) => {
            const Icon = moduleIcon(m.code)
            const card = (
              <Card
                className={`p-4 ${m.active ? 'hover:border-brand-500' : 'opacity-70'}`}
              >
                <div className="flex items-start gap-3">
                  <Icon className="h-6 w-6 shrink-0 text-brand-600" />
                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-wide text-neutral-500">
                      {m.code.startsWith('fase') ? `Fase ${m.phase}` : 'Módulo'}
                    </p>
                    <h3 className="mt-1 font-medium text-neutral-900">{m.name}</h3>
                    <p className="mt-2 text-sm text-neutral-500">{m.active ? 'Abrir painel →' : 'Não iniciado'}</p>
                  </div>
                </div>
              </Card>
            )
            return m.active ? (
              <Link key={m.id} href={`/dashboard/${m.code}`}>
                {card}
              </Link>
            ) : (
              <div key={m.id}>{card}</div>
            )
          })}
          {modules.length === 0 && (
            <Callout tone="warning">Nenhum módulo foi liberado para o seu usuário. Procure um administrador.</Callout>
          )}
        </div>
      </section>

      {admin && (
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card className="p-4">
            <StatTile label="Fontes de dados" value={datasets} hint="datasets ativos" />
            <Link href="/dashboard/datasets" className="mt-3 inline-block text-sm text-brand-700 hover:underline">
              Gerenciar →
            </Link>
          </Card>
          <Card className="p-4">
            <SectionHeading className="text-base">Últimas sincronizações</SectionHeading>
            {lastRuns.length === 0 ? (
              <p className="mt-2 text-sm text-neutral-500">Nenhuma sincronização executada ainda.</p>
            ) : (
              <ul className="mt-2 space-y-1.5 text-sm">
                {lastRuns.map((r) => (
                  <li key={r.id} className="flex items-center justify-between">
                    <span>{r.dataset.name}</span>
                    <Badge tone={r.status === 'SUCCESS' ? 'brand' : r.status === 'ERROR' ? 'danger' : 'warning'}>
                      {r.status === 'SUCCESS' ? `${r.rowsUpserted} linhas` : r.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      )}
    </div>
  )
}
