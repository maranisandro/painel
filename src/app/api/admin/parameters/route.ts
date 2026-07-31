import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { requireEditor, badRequest } from '@/lib/api-helpers'
import { validateParameterDefinition } from '@/lib/semantic/parameters'

const parameterSchema = z.object({
  code: z.string().min(2).regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'code deve ser identificador (letras, números, _)'),
  name: z.string().min(2),
  description: z.string().nullable().optional(),
  valueNumber: z.number().nullable().optional(),
  valueText: z.string().nullable().optional(),
  formula: z.string().nullable().optional(),
})

export async function GET() {
  const auth = await requireEditor()
  if ('error' in auth) return auth.error
  const parameters = await prisma.parameter.findMany({ orderBy: { code: 'asc' } })
  return NextResponse.json(parameters)
}

export async function POST(req: NextRequest) {
  const auth = await requireEditor()
  if ('error' in auth) return auth.error
  const parsed = parameterSchema.safeParse(await req.json())
  if (!parsed.success) return badRequest(parsed.error.issues.map((i) => i.message).join('; '))

  try {
    const all = await prisma.parameter.findMany()
    validateParameterDefinition(
      parsed.data,
      all.map((parameter) => ({
        code: parameter.code,
        valueNumber: parameter.valueNumber === null ? null : Number(parameter.valueNumber),
        formula: parameter.formula,
      })),
    )
  } catch (err) {
    return badRequest(`Fórmula inválida: ${err instanceof Error ? err.message : String(err)}`)
  }

  const parameter = await prisma.parameter.create({ data: parsed.data })
  await logAudit({
    userId: auth.user.id,
    userName: auth.user.name,
    action: 'CREATE',
    entity: 'Parameter',
    entityId: parameter.id,
    details: parsed.data,
  })
  return NextResponse.json(parameter, { status: 201 })
}
