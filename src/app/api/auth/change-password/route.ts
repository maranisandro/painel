import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/authz'
import { logAudit } from '@/lib/audit'

const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z
    .string()
    .min(10, 'A nova senha precisa ter pelo menos 10 caracteres')
    .regex(/[A-Za-z]/, 'A nova senha precisa ter pelo menos uma letra')
    .regex(/[0-9]/, 'A nova senha precisa ter pelo menos um número'),
})

/** Troca a senha do próprio usuário logado — exige a senha atual. */
export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'não autorizado' }, { status: 401 })

  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join('; ') }, { status: 400 })
  }

  const record = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
  const isValid = await bcrypt.compare(parsed.data.currentPassword, record.password)
  if (!isValid) return NextResponse.json({ error: 'Senha atual incorreta' }, { status: 400 })

  const newHash = await bcrypt.hash(parsed.data.newPassword, 10)
  await prisma.user.update({
    where: { id: user.id },
    data: { password: newHash, mustChangePassword: false },
  })
  await logAudit({
    userId: user.id,
    userName: user.name,
    action: 'PASSWORD_CHANGE',
    entity: 'User',
    entityId: user.id,
  })
  return NextResponse.json({ ok: true })
}
