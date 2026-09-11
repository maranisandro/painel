import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireAdmin, badRequest } from '@/lib/api-helpers'
import { logAudit } from '@/lib/audit'

const updateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(['ADMIN', 'EDITOR', 'VIEWER']),
  active: z.boolean(),
  moduleCodes: z.array(z.string().min(1)).transform((codes) => [...new Set(codes)]),
  // Acesso granular por tela de Cadastro (pedido do usuário 2026-08-14) — mesmo padrão de moduleCodes
  resourceCodes: z.array(z.string().min(1)).default([]).transform((codes) => [...new Set(codes)]),
  distribuidores: z.array(z.string().min(1)).default([]).transform((codes) => [...new Set(codes)]),
  clientes: z.array(z.string().min(1)).default([]).transform((codes) => [...new Set(codes)]),
})

const userSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  active: true,
  mustChangePassword: true,
  createdAt: true,
  moduleAccesses: {
    orderBy: { module: { phase: 'asc' as const } },
    select: {
      module: { select: { id: true, code: true, name: true, phase: true, active: true } },
    },
  },
  adminAccesses: {
    orderBy: { resource: { position: 'asc' as const } },
    select: {
      resource: { select: { id: true, code: true, name: true, position: true } },
    },
  },
  distributorScopes: { select: { distribuidor: true } },
  clientScopes: { select: { cliente: true } },
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error
  const { id } = await params

  const parsed = updateSchema.safeParse(await req.json())
  if (!parsed.success) return badRequest(parsed.error.issues.map((issue) => issue.message).join('; '))

  const existing = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      active: true,
      moduleAccesses: { select: { module: { select: { code: true } } } },
      adminAccesses: { select: { resource: { select: { code: true } } } },
      distributorScopes: { select: { distribuidor: true } },
      clientScopes: { select: { cliente: true } },
    },
  })
  if (!existing) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })

  if (id === auth.user.id && (!parsed.data.active || parsed.data.role !== 'ADMIN')) {
    return badRequest('Você não pode inativar ou remover seu próprio perfil de administrador')
  }

  const emailOwner = await prisma.user.findFirst({
    where: {
      id: { not: id },
      email: { equals: parsed.data.email, mode: 'insensitive' },
    },
    select: { id: true },
  })
  if (emailOwner) return NextResponse.json({ error: 'E-mail já cadastrado' }, { status: 409 })

  const modules = await prisma.module.findMany({
    where: { code: { in: parsed.data.moduleCodes } },
    select: { id: true, code: true },
  })
  if (modules.length !== parsed.data.moduleCodes.length) {
    return badRequest('Um ou mais módulos informados não existem')
  }
  const resources = await prisma.adminResource.findMany({
    where: { code: { in: parsed.data.resourceCodes } },
    select: { id: true, code: true },
  })
  if (resources.length !== parsed.data.resourceCodes.length) {
    return badRequest('Um ou mais cadastros informados não existem')
  }

  const before = {
    name: existing.name,
    email: existing.email,
    role: existing.role,
    active: existing.active,
    moduleCodes: existing.moduleAccesses.map((access) => access.module.code).sort(),
    resourceCodes: existing.adminAccesses.map((access) => access.resource.code).sort(),
    distribuidores: existing.distributorScopes.map((s) => s.distribuidor).sort(),
    clientes: existing.clientScopes.map((s) => s.cliente).sort(),
  }

  let user
  try {
    user = await prisma.$transaction(async (tx) => {
      const removesActiveAdmin =
        existing.role === 'ADMIN' &&
        existing.active &&
        (parsed.data.role !== 'ADMIN' || !parsed.data.active)

      if (removesActiveAdmin) {
        // Serializa somente as operações que podem remover administradores.
        // Assim duas requisições concorrentes não conseguem deixar o sistema sem admin.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(72726163)`
        const activeAdmins = await tx.user.count({ where: { role: 'ADMIN', active: true } })
        if (activeAdmins <= 1) throw new Error('LAST_ACTIVE_ADMIN')
      }

      await tx.userModuleAccess.deleteMany({ where: { userId: id } })
      await tx.userAdminAccess.deleteMany({ where: { userId: id } })
      await tx.userDistributorScope.deleteMany({ where: { userId: id } })
      await tx.userClientScope.deleteMany({ where: { userId: id } })
      return tx.user.update({
        where: { id },
        data: {
          name: parsed.data.name,
          email: parsed.data.email,
          role: parsed.data.role,
          active: parsed.data.active,
          sessionVersion:
            existing.role !== parsed.data.role || existing.active !== parsed.data.active
              ? { increment: 1 }
              : undefined,
          moduleAccesses:
            parsed.data.role !== 'ADMIN' && modules.length > 0
              ? { create: modules.map((module) => ({ moduleId: module.id })) }
              : undefined,
          adminAccesses:
            parsed.data.role !== 'ADMIN' && resources.length > 0
              ? { create: resources.map((resource) => ({ resourceId: resource.id })) }
              : undefined,
          distributorScopes:
            parsed.data.role !== 'ADMIN' && parsed.data.distribuidores.length > 0
              ? { create: parsed.data.distribuidores.map((distribuidor) => ({ distribuidor })) }
              : undefined,
          clientScopes:
            parsed.data.role !== 'ADMIN' && parsed.data.clientes.length > 0
              ? { create: parsed.data.clientes.map((cliente) => ({ cliente })) }
              : undefined,
        },
        select: userSelect,
      })
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'LAST_ACTIVE_ADMIN') {
      return badRequest('O sistema precisa manter pelo menos um administrador ativo')
    }
    throw error
  }

  await logAudit({
    userId: auth.user.id,
    userName: auth.user.name,
    action: 'UPDATE',
    entity: 'User',
    entityId: user.id,
    details: {
      before,
      after: {
        name: user.name,
        email: user.email,
        role: user.role,
        active: user.active,
        moduleCodes: user.moduleAccesses.map((access) => access.module.code).sort(),
        resourceCodes: user.adminAccesses.map((access) => access.resource.code).sort(),
        distribuidores: user.distributorScopes.map((s) => s.distribuidor).sort(),
        clientes: user.clientScopes.map((s) => s.cliente).sort(),
      },
    },
  })

  return NextResponse.json(user)
}
