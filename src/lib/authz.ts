import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import type { UserRole } from '@prisma/client'

export interface SessionUser {
  id: string
  name: string
  email: string
  role: UserRole
  active: boolean
  mustChangePassword: boolean
  sessionVersion: number
  moduleCodes: string[]
}

/**
 * Resolve o usuário da sessão lendo o papel/estado ATUAL do banco — não do
 * token JWT, que pode estar defasado (papel alterado após o login).
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return null

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      active: true,
      mustChangePassword: true,
      sessionVersion: true,
      moduleAccesses: { select: { module: { select: { code: true } } } },
    },
  })
  if (!user || !user.active) return null
  if (session.user.sessionVersion !== user.sessionVersion) return null

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    active: user.active,
    mustChangePassword: user.mustChangePassword,
    sessionVersion: user.sessionVersion,
    moduleCodes: user.moduleAccesses.map((access) => access.module.code),
  }
}

export function isAdmin(user: SessionUser | null): boolean {
  return user?.role === 'ADMIN'
}

export function canEdit(user: SessionUser | null): boolean {
  return user?.role === 'ADMIN' || user?.role === 'EDITOR'
}

export function hasModuleAccess(user: SessionUser | null, moduleCode: string): boolean {
  if (!user) return false
  return isAdmin(user) || user.moduleCodes.includes(moduleCode)
}

export function canEditModule(user: SessionUser | null, moduleCode: string): boolean {
  return canEdit(user) && hasModuleAccess(user, moduleCode)
}

export function accessibleModuleCodes(user: SessionUser | null): string[] {
  return user ? (isAdmin(user) ? [] : user.moduleCodes) : []
}
