import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, isAdmin } from '@/lib/authz'
import { buscarPosicaoIndividual } from '@/lib/sync/omnilink-manual'
import { logAudit } from '@/lib/audit'

/**
 * Busca sob demanda a posição de uma placa específica no Omnilink, fora do
 * ciclo normal de sincronização — pedido do usuário 2026-08-17: "tentar os
 * que estão a muito tempo parado individualmente". Ação admin-only, mesmo
 * padrão de `/api/datasets/[id]/sync` (chama uma API externa de verdade).
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!isAdmin(user)) {
    return NextResponse.json({ error: 'acesso negado' }, { status: user ? 403 : 401 })
  }

  const body = (await req.json().catch(() => null)) as { placa?: string } | null
  const placa = body?.placa?.trim()
  if (!placa) return NextResponse.json({ error: 'placa é obrigatória' }, { status: 400 })

  try {
    const resultado = await buscarPosicaoIndividual(placa)
    await logAudit({
      userId: user!.id,
      userName: user!.name,
      action: 'OMNILINK_BUSCA_INDIVIDUAL',
      entity: 'VehiclePosition',
      entityId: placa,
      details: resultado,
    })
    return NextResponse.json(resultado)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Falha ao buscar posição: ${msg}` }, { status: 500 })
  }
}
