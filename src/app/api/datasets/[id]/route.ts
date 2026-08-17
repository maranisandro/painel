import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { requireAdmin, badRequest } from '@/lib/api-helpers'

const updateSchema = z.object({
  query: z.string().min(1).optional(),
  intervalMinutes: z.number().int().min(1).optional(),
  enabled: z.boolean().optional(),
})

/**
 * Edição de fonte de dados (pedido do usuário 2026-08-05: "alterar as
 * consultas das fontes de dados para o tempo de execução ser digitado. Dar a
 * opção de alterar também a consulta") — admin pode digitar o intervalo de
 * sincronização (SyncSchedule.intervalMinutes, único modelo de agendamento
 * que existe hoje, sem cron/horário fixo) e editar a consulta (Dataset.query)
 * pela tela, em vez de só via prisma/seed.ts.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error
  const { id } = await params
  const parsed = updateSchema.safeParse(await req.json())
  if (!parsed.success) return badRequest(parsed.error.issues.map((i) => i.message).join('; '))
  const { query, intervalMinutes, enabled } = parsed.data
  if (query === undefined && intervalMinutes === undefined && enabled === undefined) {
    return badRequest('nada para atualizar')
  }

  const dataset = await prisma.dataset.findUnique({ where: { id }, include: { schedule: true } })
  if (!dataset) return NextResponse.json({ error: 'dataset não encontrado' }, { status: 404 })

  if (query !== undefined) {
    await prisma.dataset.update({ where: { id }, data: { query } })
  }

  if (intervalMinutes !== undefined || enabled !== undefined) {
    const nextIntervalMinutes = intervalMinutes ?? dataset.schedule?.intervalMinutes ?? 60
    const nextEnabled = enabled ?? dataset.schedule?.enabled ?? true
    await prisma.syncSchedule.upsert({
      where: { datasetId: id },
      create: {
        datasetId: id,
        intervalMinutes: nextIntervalMinutes,
        enabled: nextEnabled,
        nextRunAt: new Date(Date.now() + nextIntervalMinutes * 60_000),
      },
      update: {
        intervalMinutes: nextIntervalMinutes,
        enabled: nextEnabled,
        // Recalcula o próximo horário a partir de AGORA sempre que o
        // intervalo digitado mudar — senão o novo valor só valeria a partir
        // do próximo cálculo (lastRunAt antigo + intervalo novo), o que
        // poderia atrasar ou adiantar de forma confusa para quem acabou de
        // digitar o número.
        ...(intervalMinutes !== undefined ? { nextRunAt: new Date(Date.now() + nextIntervalMinutes * 60_000) } : {}),
      },
    })
  }

  await logAudit({
    userId: auth.user.id,
    userName: auth.user.name,
    action: 'UPDATE',
    entity: 'Dataset',
    entityId: id,
    details: { queryAlterada: query !== undefined, intervalMinutes, enabled },
  })

  const updated = await prisma.dataset.findUniqueOrThrow({ where: { id }, include: { schedule: true } })
  return NextResponse.json(updated)
}
