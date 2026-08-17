import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { requireResourceViewer, requireResourceEditor, badRequest } from '@/lib/api-helpers'

const productTypeSchema = z.object({
  codigoPrd: z.string().min(1).transform((v) => v.trim()),
  produtoNome: z.string().nullable().optional(),
  tipoProduto: z.string().min(1),
  active: z.boolean().optional(),
})

export async function GET() {
  const auth = await requireResourceViewer('produtos')
  if ('error' in auth) return auth.error
  const productTypes = await prisma.productType.findMany({ orderBy: { codigoPrd: 'asc' } })
  return NextResponse.json(productTypes)
}

export async function POST(req: NextRequest) {
  const auth = await requireResourceEditor('produtos')
  if ('error' in auth) return auth.error
  const parsed = productTypeSchema.safeParse(await req.json())
  if (!parsed.success) return badRequest(parsed.error.issues.map((i) => i.message).join('; '))

  const productType = await prisma.productType.create({ data: parsed.data })
  await logAudit({
    userId: auth.user.id,
    userName: auth.user.name,
    action: 'CREATE',
    entity: 'ProductType',
    entityId: productType.id,
    details: parsed.data,
  })
  return NextResponse.json(productType, { status: 201 })
}
