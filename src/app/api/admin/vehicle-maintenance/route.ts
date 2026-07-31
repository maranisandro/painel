import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { requireEditor, badRequest } from '@/lib/api-helpers'

const schema = z.object({
  placa: z.string().min(5).transform((v) => v.trim().toUpperCase()),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // null/ausente = manutenção em aberto (ainda não voltou a rodar)
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  motivo: z.string().nullable().optional(),
})

export async function GET() {
  const auth = await requireEditor()
  if ('error' in auth) return auth.error
  const records = await prisma.vehicleMaintenance.findMany({
    orderBy: [{ placa: 'asc' }, { startDate: 'desc' }],
  })
  return NextResponse.json(records)
}

export async function POST(req: NextRequest) {
  const auth = await requireEditor()
  if ('error' in auth) return auth.error
  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return badRequest(parsed.error.issues.map((i) => i.message).join('; '))

  const { placa, startDate, endDate, motivo } = parsed.data

  // Não permite abrir uma nova manutenção se já existe uma em aberto para a placa
  const existingOpen = await prisma.vehicleMaintenance.findFirst({ where: { placa, endDate: null } })
  if (!endDate && existingOpen) {
    return badRequest('Esta placa já está em manutenção em aberto — retire da manutenção antes de abrir outra.')
  }

  const record = await prisma.vehicleMaintenance.create({
    data: {
      placa,
      startDate: new Date(`${startDate}T00:00:00`),
      endDate: endDate ? new Date(`${endDate}T00:00:00`) : null,
      motivo: motivo ?? null,
    },
  })
  await logAudit({
    userId: auth.user.id,
    userName: auth.user.name,
    action: 'CREATE',
    entity: 'VehicleMaintenance',
    entityId: record.id,
    details: parsed.data,
  })
  return NextResponse.json(record, { status: 201 })
}
