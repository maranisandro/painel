import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { requireResourceViewer, requireResourceEditor, badRequest } from '@/lib/api-helpers'

const schema = z.object({
  motorista: z.string().min(2).transform((v) => v.trim().toUpperCase()),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // null/ausente = férias em aberto (ainda não voltou)
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
})

export async function GET() {
  const auth = await requireResourceViewer('ferias')
  if ('error' in auth) return auth.error
  const records = await prisma.driverVacation.findMany({
    orderBy: [{ motorista: 'asc' }, { startDate: 'desc' }],
  })
  return NextResponse.json(records)
}

export async function POST(req: NextRequest) {
  const auth = await requireResourceEditor('ferias')
  if ('error' in auth) return auth.error
  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return badRequest(parsed.error.issues.map((i) => i.message).join('; '))

  const { motorista, startDate, endDate } = parsed.data

  const existingOpen = await prisma.driverVacation.findFirst({ where: { motorista, endDate: null } })
  if (!endDate && existingOpen) {
    return badRequest('Este motorista já está de férias em aberto — encerre antes de abrir outro período.')
  }

  const record = await prisma.driverVacation.create({
    data: {
      motorista,
      startDate: new Date(`${startDate}T00:00:00`),
      endDate: endDate ? new Date(`${endDate}T00:00:00`) : null,
    },
  })
  await logAudit({
    userId: auth.user.id,
    userName: auth.user.name,
    action: 'CREATE',
    entity: 'DriverVacation',
    entityId: record.id,
    details: parsed.data,
  })
  return NextResponse.json(record, { status: 201 })
}
