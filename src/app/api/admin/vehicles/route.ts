import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { requireResourceViewer, requireResourceEditor, badRequest } from '@/lib/api-helpers'

const vehicleSchema = z.object({
  placa: z.string().min(1).transform((v) => v.trim().toUpperCase()),
  precisaRastreamento: z.boolean().optional(),
  codTra: z.string().nullable().optional(),
  ativo: z.boolean().optional(),
  observacoes: z.string().nullable().optional(),
})

export async function GET() {
  const auth = await requireResourceViewer('veiculos')
  if ('error' in auth) return auth.error
  const vehicles = await prisma.vehicle.findMany({ orderBy: { placa: 'asc' } })
  return NextResponse.json(vehicles)
}

export async function POST(req: NextRequest) {
  const auth = await requireResourceEditor('veiculos')
  if ('error' in auth) return auth.error
  const parsed = vehicleSchema.safeParse(await req.json())
  if (!parsed.success) return badRequest(parsed.error.issues.map((i) => i.message).join('; '))

  const vehicle = await prisma.vehicle.create({ data: parsed.data })
  await logAudit({
    userId: auth.user.id,
    userName: auth.user.name,
    action: 'CREATE',
    entity: 'Vehicle',
    entityId: vehicle.id,
    details: parsed.data,
  })
  return NextResponse.json(vehicle, { status: 201 })
}
