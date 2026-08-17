import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getSessionUser, isAdmin } from '@/lib/authz'
import { UserManagement } from './UserManagement'

export const dynamic = 'force-dynamic'

export default async function UsuariosPage() {
  const currentUser = await getSessionUser()
  if (!isAdmin(currentUser)) redirect('/dashboard')

  const [users, modules, resources] = await Promise.all([
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
  ])

  return (
    <UserManagement
      currentUserId={currentUser!.id}
      modules={modules}
      resources={resources}
      users={users.map((user) => ({
        ...user,
        createdAt: user.createdAt.toISOString(),
        moduleCodes: user.moduleAccesses.map((access) => access.module.code),
        resourceCodes: user.adminAccesses.map((access) => access.resource.code),
      }))}
    />
  )
}
