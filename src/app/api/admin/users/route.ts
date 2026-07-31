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

export async function GET() {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  const [users, modules] = await Promise.all([
    prisma.user.findMany({ select: userSelect, orderBy: { name: 'asc' } }),
    prisma.module.findMany({
      select: { id: true, code: true, name: true, phase: true, active: true },
      orderBy: { phase: 'asc' },
    }),
  ])
  return NextResponse.json({ users, modules, currentUserId: auth.user.id })
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
      mustChangePassword: true,
    },
  })

  return NextResponse.json({ user, temporaryPassword }, { status: 201 })
}
