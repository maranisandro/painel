import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { requireEditor, badRequest } from '@/lib/api-helpers'

const polygonSchema = z
  .array(z.object({ lat: z.number(), lng: z.number() }))
  .min(3)
  .nullable()
  .optional()

const updateSchema = z.object({
  name: z.string().min(2).optional(),
  officialName: z.string().nullable().optional(),
  type: z.enum(['UNIDADE', 'CLIENTE']).optional(),
  matchColigada: z.number().int().nullable().optional(),
  matchFilial: z.number().int().nullable().optional(),
  matchClientePattern: z.string().nullable().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  raioMetros: z.number().nullable().optional(),
  polygon: polygonSchema,
  active: z.boolean().optional(),
})

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireEditor()
  if ('error' in auth) return auth.error
  const { id } = await params
  const parsed = updateSchema.safeParse(await req.json())
  if (!parsed.success) return badRequest(parsed.error.issues.map((i) => i.message).join('; '))

  const location = await prisma.location.update({
    where: { id },
    data: { ...parsed.data, polygon: parsed.data.polygon === null ? Prisma.JsonNull : parsed.data.polygon },
  })
  await logAudit({
    userId: auth.user.id,
    userName: auth.user.name,
    action: 'UPDATE',
    entity: 'Location',
    entityId: id,
    details: parsed.data,
  })
  return NextResponse.json(location)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireEditor()
  if ('error' in auth) return auth.error
  const { id } = await params
  const routes = await prisma.route.count({ where: { OR: [{ originId: id }, { destinationId: id }] } })
  if (routes > 0) return badRequest('Local em uso por rotas — remova as rotas primeiro ou inative o local.')

  await prisma.location.delete({ where: { id } })
  await logAudit({
    userId: auth.user.id,
    userName: auth.user.name,
    action: 'DELETE',
    entity: 'Location',
    entityId: id,
  })
  return NextResponse.json({ ok: true })
}
