import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { requireResourceEditor, badRequest } from '@/lib/api-helpers'
import { hojeBrasil } from '@/lib/horario-brasil'

const schema = z.object({
  placa: z.string().min(5).transform((v) => v.trim().toUpperCase()),
  motivo: z.string().trim().nullable().optional(),
})

/**
 * Botão rápido na lista de veículos (pedido do usuário 2026-08-14): iniciar/
 * parar manutenção sem precisar ir em Cadastros → Manutenção. Reaproveita o
 * mesmo model `VehicleMaintenance` e a mesma regra de negócio já existente
 * lá — placa em manutenção continua contando na meta/ritmo (não é excluída
 * das análises), só passa a acumular "dias parados" em vez de km/viagens
 * (que naturalmente não existem, já que o caminhão não roda).
 *
 * Sem placa em aberto → cria uma nova (startDate=hoje, endDate=null).
 * Com placa em aberto → encerra (endDate=hoje).
 */
export async function POST(req: NextRequest) {
  const auth = await requireResourceEditor('manutencao')
  if ('error' in auth) return auth.error

  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return badRequest(parsed.error.issues.map((i) => i.message).join('; '))
  const { placa, motivo } = parsed.data
  const hoje = hojeBrasil()

  const aberta = await prisma.vehicleMaintenance.findFirst({ where: { placa, endDate: null } })

  if (aberta) {
    const record = await prisma.vehicleMaintenance.update({
      where: { id: aberta.id },
      data: { endDate: new Date(`${hoje}T00:00:00`) },
    })
    await logAudit({
      userId: auth.user.id,
      userName: auth.user.name,
      action: 'UPDATE',
      entity: 'VehicleMaintenance',
      entityId: record.id,
      details: { endDate: hoje, origem: 'botao_lista_veiculos' },
    })
    return NextResponse.json({ aberta: false, record })
  }

  const record = await prisma.vehicleMaintenance.create({
    data: {
      placa,
      startDate: new Date(`${hoje}T00:00:00`),
      endDate: null,
      motivo: motivo?.trim() || null,
    },
  })
  await logAudit({
    userId: auth.user.id,
    userName: auth.user.name,
    action: 'CREATE',
    entity: 'VehicleMaintenance',
    entityId: record.id,
    details: { placa, startDate: hoje, origem: 'botao_lista_veiculos' },
  })
  return NextResponse.json({ aberta: true, record })
}
