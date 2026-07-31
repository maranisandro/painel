import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { requireEditor, badRequest } from '@/lib/api-helpers'

const routeSchema = z.object({
  originId: z.string().uuid(),
  destinationId: z.string().uuid(),
  distanceAsphaltKm: z.number().min(0),
  distanceDirtKm: z.number().min(0),
  speedLoadedKmh: z.number().positive().nullable().optional(),
  speedEmptyKmh: z.number().positive().nullable().optional(),
  loadMinutes: z.number().int().min(0).nullable().optional(),
  unloadMinutes: z.number().int().min(0).nullable().optional(),
  expectedRoundTripDays: z.number().positive().nullable().optional(),
  fixedComposition: z.string().nullable().optional(),
  active: z.boolean().optional(),
})

export async function GET() {
  const auth = await requireEditor()
  if ('error' in auth) return auth.error
  const routes = await prisma.route.findMany({
    include: { origin: true, destination: true },
    orderBy: [{ origin: { name: 'asc' } }, { destination: { name: 'asc' } }],
  })
  return NextResponse.json(routes)
}

export async function POST(req: NextRequest) {
  const auth = await requireEditor()
  if ('error' in auth) return auth.error
  const parsed = routeSchema.safeParse(await req.json())
  if (!parsed.success) return badRequest(parsed.error.issues.map((i) => i.message).join('; '))

  const route = await prisma.route.create({
    data: parsed.data,
    include: { origin: true, destination: true },
  })
  await logAudit({
    userId: auth.user.id,
    userName: auth.user.name,
    action: 'CREATE',
    entity: 'Route',
    entityId: route.id,
    details: parsed.data,
  })
  return NextResponse.json(route, { status: 201 })
}
