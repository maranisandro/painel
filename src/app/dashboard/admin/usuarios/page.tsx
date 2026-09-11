import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getSessionUser, isAdmin } from '@/lib/authz'
import { getDatasetView } from '@/lib/semantic/dataset-view'
import { DISTRIBUIDORES_CONHECIDOS } from '@/lib/fase3/faturamento'
import { UserManagement } from './UserManagement'

export const dynamic = 'force-dynamic'

export default async function UsuariosPage() {
  const currentUser = await getSessionUser()
  if (!isAdmin(currentUser)) redirect('/dashboard')

  const [users, modules, resources, vendasView] = await Promise.all([
    prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        active: true,
        mustChangePassword: true,
        createdAt: true,
        moduleAccesses: {
          orderBy: { module: { phase: 'asc' } },
          select: {
            module: { select: { id: true, code: true, name: true, phase: true, active: true } },
          },
        },
        adminAccesses: {
          orderBy: { resource: { position: 'asc' } },
          select: {
            resource: { select: { id: true, code: true, name: true, position: true } },
          },
        },
        distributorScopes: { select: { distribuidor: true } },
        clientScopes: { select: { cliente: true } },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.module.findMany({
      select: { id: true, code: true, name: true, phase: true, active: true },
      orderBy: { phase: 'asc' },
    }),
    prisma.adminResource.findMany({
      select: { id: true, code: true, name: true, position: true },
      orderBy: { position: 'asc' },
    }),
    // Universo de clientes pro seletor de escopo (Task 7) — mesmo dataset já
    // usado pelos filtros de venda da Fase 3, sem cadastro novo.
    getDatasetView('fase3_vendas_madeira_tratada').catch(() => []),
  ])

  const clientesDisponiveis = [
    ...new Set((vendasView as Record<string, unknown>[]).map((r) => String(r.CLIENTE ?? '').trim()).filter(Boolean)),
  ].sort()

  return (
    <UserManagement
      currentUserId={currentUser!.id}
      modules={modules}
      resources={resources}
      distribuidoresDisponiveis={[...DISTRIBUIDORES_CONHECIDOS].sort()}
      clientesDisponiveis={clientesDisponiveis}
      users={users.map((user) => ({
        ...user,
        createdAt: user.createdAt.toISOString(),
        moduleCodes: user.moduleAccesses.map((access) => access.module.code),
        resourceCodes: user.adminAccesses.map((access) => access.resource.code),
        distribuidores: user.distributorScopes.map((scope) => scope.distribuidor),
        clientes: user.clientScopes.map((scope) => scope.cliente),
      }))}
    />
  )
}
