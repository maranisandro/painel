import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSessionUser } from '@/lib/authz'
import { prisma } from '@/lib/prisma'

const eventSchema = z.object({
  type: z.enum(['PAGE_VIEW', 'HEARTBEAT']),
  path: z.string().startsWith('/dashboard'),
})

/** Deriva o "módulo" do path para agregação (ex. /dashboard/fase1/mapa -> "fase1", /dashboard -> "home"). */
function moduleFromPath(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts[1] ?? 'home'
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'não autorizado' }, { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'corpo inválido' }, { status: 400 })
  }
  const parsed = eventSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join('; ') }, { status: 400 })
  }

  await prisma.usageEvent.create({
    data: {
      userId: user.id,
      type: parsed.data.type,
      path: parsed.data.path,
      module: moduleFromPath(parsed.data.path),
    },
  })

  return new NextResponse(null, { status: 204 })
}
