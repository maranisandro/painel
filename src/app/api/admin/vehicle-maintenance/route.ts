import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { requireResourceViewer, requireResourceEditor, badRequest } from '@/lib/api-helpers'
import { justificarViagemAoIniciarManutencao } from '@/lib/fase1/manutencao'

const schema = z.object({
  placa: z.string().min(5).transform((v) => v.trim().toUpperCase()),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // null/ausente = manutenção em aberto (ainda não voltou a rodar)
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  previsaoConclusao: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  motivo: z.string().nullable().optional(),
})

export async function GET() {
  const auth = await requireResourceViewer('manutencao')
  if ('error' in auth) return auth.error
  const records = await prisma.vehicleMaintenance.findMany({
    orderBy: [{ placa: 'asc' }, { startDate: 'desc' }],
  })
  return NextResponse.json(records)
}

export async function POST(req: NextRequest) {
  const auth = await requireResourceEditor('manutencao')
  if ('error' in auth) return auth.error
  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return badRequest(parsed.error.issues.map((i) => i.message).join('; '))

  const { placa, startDate, endDate, previsaoConclusao, motivo } = parsed.data

  // Não permite abrir uma nova manutenção se já existe uma em aberto para a placa
  const existingOpen = await prisma.vehicleMaintenance.findFirst({ where: { placa, endDate: null } })
  if (!endDate && existingOpen) {
    return badRequest('Esta placa já está em manutenção em aberto — retire da manutenção antes de abrir outra.')
  }

  const startDateObj = new Date(`${startDate}T00:00:00`)
  const record = await prisma.vehicleMaintenance.create({
    data: {
      placa,
      startDate: startDateObj,
      endDate: endDate ? new Date(`${endDate}T00:00:00`) : null,
      previsaoConclusao: previsaoConclusao ? new Date(`${previsaoConclusao}T00:00:00`) : null,
      motivo: motivo ?? null,
    },
  })
  // Manutenção aberta (sem endDate) encerra o ciclo da última viagem da placa —
  // ver src/lib/fase1/manutencao.ts.
  if (!endDate) {
    await justificarViagemAoIniciarManutencao(
      placa,
      startDateObj,
      previsaoConclusao ? new Date(`${previsaoConclusao}T00:00:00`) : null,
    )
  }
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
