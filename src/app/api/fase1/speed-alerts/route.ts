import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireModuleViewer } from '@/lib/api-helpers'

// Lista os episódios de excesso de velocidade (abertos e já reconhecidos) —
// pedido do usuário 2026-08-03: velocidade acima do limite dos Parâmetros
// precisa de reconhecimento formal do operador da logística, registrado.
export async function GET() {
  const auth = await requireModuleViewer('fase1')
  if ('error' in auth) return auth.error
  const alerts = await prisma.speedAlert.findMany({ orderBy: { createdAt: 'desc' }, take: 200 })
  return NextResponse.json(alerts)
}
