import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { requireEditor, badRequest } from '@/lib/api-helpers'

const locationSchema = z.object({
  name: z.string().min(2),
  officialName: z.string().nullable().optional(),
  type: z.enum(['UNIDADE', 'CLIENTE']),
  matchColigada: z.number().int().nullable().optional(),
  matchFilial: z.number().int().nullable().optional(),
  matchClientePattern: z.string().nullable().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  raioMetros: z.number().nullable().optional(),
  active: z.boolean().optional(),
})

export async function GET() {
  const auth = await requireEditor()
  if ('error' in auth) return auth.error
  const locations = await prisma.location.findMany({
    orderBy: [{ type: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { routesFrom: true, routesTo: true } } },
  })
  return NextResponse.json(locations)
}

export async function POST(req: NextRequest) {
  const auth = await requireEditor()
  if ('error' in auth) return auth.error
  const parsed = locationSchema.safeParse(await req.json())
  if (!parsed.success) return badRequest(parsed.error.issues.map((i) => i.message).join('; '))

  const location = await prisma.location.create({ data: parsed.data })
  await logAudit({
    userId: auth.user.id,
    userName: auth.user.name,
    action: 'CREATE',
    entity: 'Location',
    entityId: location.id,
    details: parsed.data,
  })
  return NextResponse.json(location, { status: 201 })
}
