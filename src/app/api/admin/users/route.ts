import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireAdmin, badRequest } from '@/lib/api-helpers'
import { logAudit } from '@/lib/audit'

const passwordSchema = z
  .string()
  .min(10)
  .regex(/[A-Za-z]/)
  .regex(/[0-9]/)

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(['ADMIN', 'EDITOR', 'VIEWER']),
  moduleCodes: z.array(z.string().min(1)).default([]).transform((codes) => [...new Set(codes)]),
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

function generateTemporaryPassword(): string {
  const password = `${randomBytes(9).toString('base64url')}Aa1!`
  return passwordSchema.parse(password)
}

async function resolveModules(moduleCodes: string[]) {
  const modules = await prisma.module.findMany({
    where: { code: { in: moduleCodes } },
    select: { id: true, code: true },
  })
  if (modules.length !== moduleCodes.length) return null
  return modules
}

async function resolveResources(resourceCodes: string[]) {
  const resources = await prisma.adminResource.findMany({
    where: { code: { in: resourceCodes } },
    select: { id: true, code: true },
  })
  if (resources.length !== resourceCodes.length) return null
  return resources
}

export async function GET() {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  const [users, modules, resources] = await Promise.all([
    prisma.user.findMany({ select: userSelect, orderBy: { name: 'asc' } }),
    prisma.module.findMany({
      select: { id: true, code: true, name: true, phase: true, active: true },
      orderBy: { phase: 'asc' },
    }),
    prisma.adminResource.findMany({
      select: { id: true, code: true, name: true, position: true },
      orderBy: { position: 'asc' },
    }),
  ])
  return NextResponse.json({ users, modules, resources, currentUserId: auth.user.id })
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  const parsed = createSchema.safeParse(await req.json())
  if (!parsed.success) return badRequest(parsed.error.issues.map((issue) => issue.message).join('; '))

  const existing = await prisma.user.findFirst({
    where: { email: { equals: parsed.data.email, mode: 'insensitive' } },
    select: { id: true },
  })
  if (existing) return NextResponse.json({ error: 'E-mail já cadastrado' }, { status: 409 })

  const modules = await resolveModules(parsed.data.moduleCodes)
  if (!modules) return badRequest('Um ou mais módulos informados não existem')
  const resources = await resolveResources(parsed.data.resourceCodes)
  if (!resources) return badRequest('Um ou mais cadastros informados não existem')

  const temporaryPassword = generateTemporaryPassword()
  const password = await bcrypt.hash(temporaryPassword, 10)

  const user = await prisma.user.create({
    data: {
      name: parsed.data.name,
      email: parsed.data.email,
      password,
      role: parsed.data.role,
      mustChangePassword: true,
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

  await logAudit({
    userId: auth.user.id,
    userName: auth.user.name,
    action: 'CREATE',
    entity: 'User',
    entityId: user.id,
    details: {
      name: user.name,
      email: user.email,
      role: user.role,
      moduleCodes: user.moduleAccesses.map((access) => access.module.code),
      resourceCodes: user.adminAccesses.map((access) => access.resource.code),
      distribuidores: user.distributorScopes.map((s) => s.distribuidor),
      clientes: user.clientScopes.map((s) => s.cliente),
      mustChangePassword: true,
    },
  })

  return NextResponse.json({ user, temporaryPassword }, { status: 201 })
}
