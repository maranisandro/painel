import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { requireEditor, badRequest } from '@/lib/api-helpers'
import { validateParameterDefinition } from '@/lib/semantic/parameters'

const updateSchema = z.object({
  name: z.string().min(2).optional(),
  description: z.string().nullable().optional(),
  valueNumber: z.number().nullable().optional(),
  valueText: z.string().nullable().optional(),
  formula: z.string().nullable().optional(),
})

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireEditor()
  if ('error' in auth) return auth.error
  const { id } = await params
  const parsed = updateSchema.safeParse(await req.json())
  if (!parsed.success) return badRequest(parsed.error.issues.map((i) => i.message).join('; '))

  const [current, all] = await Promise.all([
    prisma.parameter.findUniqueOrThrow({ where: { id } }),
    prisma.parameter.findMany(),
  ])
  const candidate = { ...current, ...parsed.data }
  try {
    validateParameterDefinition(
      {
        code: candidate.code,
        valueNumber: candidate.valueNumber === null ? null : Number(candidate.valueNumber),
        formula: candidate.formula,
      },
      all.map((parameter) => ({
        code: parameter.code,
        valueNumber: parameter.valueNumber === null ? null : Number(parameter.valueNumber),
        formula: parameter.formula,
      })),
    )
  } catch (err) {
    return badRequest(`Fórmula inválida: ${err instanceof Error ? err.message : String(err)}`)
  }

  const parameter = await prisma.parameter.update({ where: { id }, data: parsed.data })

  await logAudit({
    userId: auth.user.id,
    userName: auth.user.name,
    action: 'UPDATE',
    entity: 'Parameter',
    entityId: id,
    details: parsed.data,
  })
  return NextResponse.json(parameter)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireEditor()
  if ('error' in auth) return auth.error
  const { id } = await params
  await prisma.parameter.delete({ where: { id } })
  await logAudit({
    userId: auth.user.id,
    userName: auth.user.name,
    action: 'DELETE',
    entity: 'Parameter',
    entityId: id,
  })
  return NextResponse.json({ ok: true })
}
