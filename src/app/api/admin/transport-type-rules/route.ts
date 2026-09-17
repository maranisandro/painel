import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { requireResourceViewer, requireResourceEditor, badRequest } from '@/lib/api-helpers'

const ruleSchema = z.object({
  tipo: z.string().min(1),
  prioridade: z.number().int().optional(),
  codtmv: z.string().nullable().optional(),
  produtos: z.string().nullable().optional(),
  origemColigada: z.number().int().nullable().optional(),
  origemFilial: z.number().int().nullable().optional(),
  destinoColigada: z.number().int().nullable().optional(),
  destinoFilial: z.number().int().nullable().optional(),
  ativo: z.boolean().optional(),
})

export async function GET() {
  const auth = await requireResourceViewer('regras_transporte')
  if ('error' in auth) return auth.error
  const rules = await prisma.transportTypeRule.findMany({ orderBy: { prioridade: 'asc' } })
  return NextResponse.json(rules)
}

export async function POST(req: NextRequest) {
  const auth = await requireResourceEditor('regras_transporte')
  if ('error' in auth) return auth.error
  const parsed = ruleSchema.safeParse(await req.json())
  if (!parsed.success) return badRequest(parsed.error.issues.map((i) => i.message).join('; '))

  const rule = await prisma.transportTypeRule.create({ data: parsed.data })
  await logAudit({
    userId: auth.user.id,
    userName: auth.user.name,
    action: 'CREATE',
    entity: 'TransportTypeRule',
    entityId: rule.id,
    details: parsed.data,
  })
  return NextResponse.json(rule, { status: 201 })
}
