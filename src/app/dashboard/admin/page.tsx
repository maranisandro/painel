import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSessionUser, isAdmin, canEditModule } from '@/lib/authz'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export default async function AdminPage() {
  const user = await getSessionUser()
  const admin = isAdmin(user)
  if (!admin && !canEditModule(user, 'fase1')) redirect('/dashboard')

  const [locais, rotas, parametros, composicoes, produtos, precosFrete, manutencoes, ferias, usuarios] =
    await Promise.all([
      prisma.location.count(),
      prisma.route.count(),
      prisma.parameter.count(),
      prisma.plateComposition.count(),
      prisma.productType.count(),
      prisma.routeFreightPrice.count(),
      prisma.vehicleMaintenance.count(),
      prisma.driverVacation.count(),
      admin ? prisma.user.count() : Promise.resolve(0),
    ])

  const cards = [
    {
      href: '/dashboard/admin/locais',
      title: 'Locais',
      count: locais,
      desc: 'Unidades do grupo e clientes — origens e destinos das rotas.',
    },
    {
      href: '/dashboard/admin/rotas',
      title: 'Rotas',
      count: rotas,
      desc: 'Distâncias (asfalto/terra), velocidades cheio/vazio e tempos de carga/descarga.',
    },
    {
      href: '/dashboard/admin/parametros',
      title: 'Parâmetros',
      count: parametros,
      desc: 'Metas e fórmulas usadas nos painéis (ex.: meta de KM mensal, ritmo).',
    },
    {
      href: '/dashboard/admin/composicoes',
      title: 'Composições',
      count: composicoes,
      desc: 'Implemento de cada placa, com histórico de mudanças por data, e limites de peso por composição.',
    },
    {
      href: '/dashboard/admin/produtos',
      title: 'Produtos',
      count: produtos,
      desc: 'Classificação de produto (Carvão, Cavaco, Maravalha…) por código do ERP.',
    },
    {
      href: '/dashboard/admin/precos-frete',
      title: 'Preços de frete',
      count: precosFrete,
      desc: 'Valor de referência (R$/tonelada) por rota, com histórico por data.',
    },
    {
      href: '/dashboard/admin/manutencao',
      title: 'Manutenção',
      count: manutencoes,
      desc: 'Períodos de manutenção por placa — entram no desvio de performance do painel.',
    },
    {
      href: '/dashboard/admin/ferias',
      title: 'Férias',
      count: ferias,
      desc: 'Períodos de férias por motorista.',
    },
    ...(admin
      ? [{
          href: '/dashboard/admin/usuarios',
          title: 'Usuários e acessos',
          count: usuarios,
          desc: 'Perfis, situação, senha temporária e acesso às fases do sistema.',
        }]
      : []),
  ]

  return (
    <div>
      <h1 className="text-xl font-semibold">Cadastros</h1>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Link key={c.href} href={c.href}>
            <div className="rounded-xl border border-slate-200 bg-white p-4 hover:border-emerald-500">
              <div className="flex items-baseline justify-between">
                <h2 className="font-medium">{c.title}</h2>
                <span className="text-2xl font-semibold text-emerald-700">{c.count}</span>
              </div>
              <p className="mt-2 text-sm text-slate-500">{c.desc}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
