import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin, badRequest } from '@/lib/api-helpers'
import { logAudit } from '@/lib/audit'

function generateTemporaryPassword(): string {
  return `${randomBytes(9).toString('base64url')}Aa1!`
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error
  const { id } = await params

  if (id === auth.user.id) {
    return badRequest('Use a tela de troca de senha para alterar a sua própria senha')
  }

  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true },
  })
  if (!target) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })

  const temporaryPassword = generateTemporaryPassword()
  const password = await bcrypt.hash(temporaryPassword, 10)
  await prisma.user.update({
    where: { id },
    data: {
      password,
      mustChangePassword: true,
      sessionVersion: { increment: 1 },
    },
  })

  await logAudit({
    userId: auth.user.id,
    userName: auth.user.name,
    action: 'PASSWORD_RESET',
    entity: 'User',
    entityId: target.id,
    details: {
      name: target.name,
      email: target.email,
      mustChangePassword: true,
      sessionsInvalidated: true,
    },
  })

  return NextResponse.json({
    user: target,
    temporaryPassword,
  })
}
