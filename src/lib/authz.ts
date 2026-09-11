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
  /** Códigos de AdminResource (telas de Cadastro) que o usuário tem vínculo — ver hasResourceAccess/canEditResource */
  resourceCodes: string[]
  /** Escopo de venda (distribuidor/cliente) — `null` = sem restrição (ADMIN, ou usuário sem nenhum vínculo). Ver `aplicarEscopoUsuario`. */
  escopoVendas: { distribuidores: string[]; clientes: string[] } | null
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
      adminAccesses: { select: { resource: { select: { code: true } } } },
      distributorScopes: { select: { distribuidor: true } },
      clientScopes: { select: { cliente: true } },
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
    resourceCodes: user.adminAccesses.map((access) => access.resource.code),
    escopoVendas:
      user.role === 'ADMIN' || (user.distributorScopes.length === 0 && user.clientScopes.length === 0)
        ? null
        : {
            distribuidores: user.distributorScopes.map((s) => s.distribuidor),
            clientes: user.clientScopes.map((s) => s.cliente),
          },
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

/**
 * Acesso granular a uma tela de Cadastro (Locais, Rotas, Parâmetros...) —
 * pedido do usuário 2026-08-14: "os perfis possa ter acesso a alguns
 * cadastro". Mesma regra de hasModuleAccess/canEditModule, só que por
 * AdminResource em vez de Module.
 */
export function hasResourceAccess(user: SessionUser | null, resourceCode: string): boolean {
  if (!user) return false
  return isAdmin(user) || user.resourceCodes.includes(resourceCode)
}

export function canEditResource(user: SessionUser | null, resourceCode: string): boolean {
  return canEdit(user) && hasResourceAccess(user, resourceCode)
}

export function accessibleResourceCodes(user: SessionUser | null): string[] {
  return user ? (isAdmin(user) ? [] : user.resourceCodes) : []
}
