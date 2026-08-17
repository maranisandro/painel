import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { requireResourceViewer, requireResourceEditor, badRequest } from '@/lib/api-helpers'

const specSchema = z.object({
  composition: z.string().min(2),
  numEixos: z.string().nullable().optional(),
  pbtcMaximoTon: z.number().positive().nullable().optional(),
  taraMinTon: z.number().positive().nullable().optional(),
  taraMaxTon: z.number().positive().nullable().optional(),
  cargaLiquidaMinTon: z.number().positive().nullable().optional(),
  cargaLiquidaMaxTon: z.number().positive().nullable().optional(),
  active: z.boolean().optional(),
})

export async function GET() {
  const auth = await requireResourceViewer('composicoes')
  if ('error' in auth) return auth.error
  const specs = await prisma.compositionSpec.findMany({ orderBy: { composition: 'asc' } })
  return NextResponse.json(specs)
}

export async function POST(req: NextRequest) {
  const auth = await requireResourceEditor('composicoes')
  if ('error' in auth) return auth.error
  const parsed = specSchema.safeParse(await req.json())
  if (!parsed.success) return badRequest(parsed.error.issues.map((i) => i.message).join('; '))

  const spec = await prisma.compositionSpec.create({ data: parsed.data })
  await logAudit({
    userId: auth.user.id,
    userName: auth.user.name,
    action: 'CREATE',
    entity: 'CompositionSpec',
    entityId: spec.id,
    details: parsed.data,
  })
  return NextResponse.json(spec, { status: 201 })
}
