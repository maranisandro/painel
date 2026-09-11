import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSessionUser, isAdmin, canEditModule, hasResourceAccess } from '@/lib/authz'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export default async function AdminPage() {
  const user = await getSessionUser()
  const admin = isAdmin(user)
  const canEditFase3 = canEditModule(user, 'fase3')
  // Acesso granular por tela (pedido do usuário 2026-08-14) — cada card
  // abaixo já se filtra por hasResourceAccess; aqui só decide se a PÁGINA
  // em si é acessível (admin, algum recurso concedido, ou editor de fase3
  // pra Cotas de venda, que continua no esquema antigo por módulo).
  if (!admin && (user?.resourceCodes.length ?? 0) === 0 && !canEditFase3) redirect('/dashboard')

  const [locais, rotas, parametros, composicoes, produtos, precosFrete, manutencoes, ferias, tickets, usuarios, cotasProduto, eventosUso] =
    await Promise.all([
      prisma.location.count(),
      prisma.route.count(),
      prisma.parameter.count(),
      prisma.plateComposition.count(),
      prisma.productType.count(),
      prisma.routeFreightPrice.count(),
      prisma.vehicleMaintenance.count(),
      prisma.driverVacation.count(),
      prisma.tripTicket.count(),
      admin ? prisma.user.count() : Promise.resolve(0),
      canEditFase3 ? prisma.productQuota.count() : Promise.resolve(0),
      hasResourceAccess(user, 'estatisticas-uso') ? prisma.usageEvent.count() : Promise.resolve(0),
    ])

  // Cada card só aparece se o usuário tiver acesso ao AdminResource
  // correspondente (pedido do usuário 2026-08-14: acesso granular por tela
  // de Cadastro) — admin sempre vê tudo (hasResourceAccess trata isso).
  const cardsPorRecurso = [
    {
      resource: 'locais',
      href: '/dashboard/admin/locais',
      title: 'Locais',
      count: locais,
      desc: 'Unidades do grupo e clientes — origens e destinos das rotas.',
    },
    {
      resource: 'rotas',
      href: '/dashboard/admin/rotas',
      title: 'Rotas',
      count: rotas,
      desc: 'Distâncias (asfalto/terra), velocidades cheio/vazio e tempos de carga/descarga.',
    },
    {
      resource: 'parametros',
      href: '/dashboard/admin/parametros',
      title: 'Parâmetros',
      count: parametros,
      desc: 'Metas e fórmulas usadas nos painéis (ex.: meta de KM mensal, ritmo).',
    },
    {
      resource: 'composicoes',
      href: '/dashboard/admin/composicoes',
      title: 'Composições',
      count: composicoes,
      desc: 'Implemento de cada placa, com histórico de mudanças por data, e limites de peso por composição.',
    },
    {
      resource: 'produtos',
      href: '/dashboard/admin/produtos',
      title: 'Produtos',
      count: produtos,
      desc: 'Classificação de produto (Carvão, Cavaco, Maravalha…) por código do ERP.',
    },
    {
      resource: 'precos_frete',
      href: '/dashboard/admin/precos-frete',
      title: 'Preços de frete',
      count: precosFrete,
      desc: 'Valor de referência (R$/tonelada) por rota, com histórico por data.',
    },
    {
      resource: 'manutencao',
      href: '/dashboard/admin/manutencao',
      title: 'Manutenção',
      count: manutencoes,
      desc: 'Períodos de manutenção por placa — entram no desvio de performance do painel.',
    },
    {
      resource: 'ferias',
      href: '/dashboard/admin/ferias',
      title: 'Férias',
      count: ferias,
      desc: 'Períodos de férias por motorista.',
    },
    {
      resource: 'tickets_viagem',
      href: '/dashboard/admin/tickets-viagem',
      title: 'Tickets de viagem',
      count: tickets,
      desc: 'Conciliação de tickets de pesagem (foto/PDF) com as notas fiscais emitidas.',
    },
    {
      resource: 'estatisticas-uso',
      href: '/dashboard/admin/estatisticas-uso',
      title: 'Estatísticas de uso',
      count: eventosUso,
      desc: 'Quem acessa, quem realmente usa, o que é mais usado, horários de uso, e quem não usa.',
    },
  ].filter((c) => hasResourceAccess(user, c.resource))

  const cards = [
    ...cardsPorRecurso,
    ...(canEditFase3
      ? [{
          href: '/dashboard/admin/cotas-venda',
          title: 'Cotas de venda (Madeira Tratada)',
          count: cotasProduto,
          desc: 'Meta mensal de volume, distribuição por ICMS, e cota por distribuidor/produto.',
        }]
      : []),
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
