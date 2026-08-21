import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, isAdmin } from '@/lib/authz'
import { prisma } from '@/lib/prisma'
import { buscarPosicaoIndividual } from '@/lib/sync/omnilink-manual'
import { logAudit } from '@/lib/audit'

/**
 * Revalida em lote todas as placas cuja ÚLTIMA tentativa de sincronização com
 * a Omnilink terminou em erro — pedido do usuário 2026-08-21: "pegar todas as
 * placas com erro e revalidar para tentar resolver todos". Mesma busca
 * individual de `/api/fase1/rastreamento/buscar-agora` (`buscarPosicaoIndividual`),
 * só que aplicada a cada placa da lista de uma vez, sequencialmente (a API da
 * Omnilink já é chamada placa por placa mesmo no ciclo normal — sequencial
 * evita disparar N requisições simultâneas contra o fornecedor).
 */
export async function POST() {
  const user = await getSessionUser()
  if (!isAdmin(user)) {
    return NextResponse.json({ error: 'acesso negado' }, { status: user ? 403 : 401 })
  }

  // Última tentativa POR PLACA, igual à consulta de /sem-comunicacao —
  // "placa com erro" aqui significa "a última coisa que tentamos foi um
  // erro", não qualquer erro histórico já superado por uma tentativa OK
  // posterior.
  const ultimasTentativas = await prisma.$queryRaw<{ placa: string; status: string }[]>`
    SELECT DISTINCT ON (placa) placa, status
    FROM omnilink_sync_placa
    ORDER BY placa, created_at DESC
  `
  const placasComErro = ultimasTentativas.filter((t) => t.status === 'ERRO').map((t) => t.placa)

  const resultados: { placa: string; ok: boolean; status: string; mensagem: string | null }[] = []
  for (const placa of placasComErro) {
    try {
      const r = await buscarPosicaoIndividual(placa)
      resultados.push({ placa, ok: r.ok, status: r.status, mensagem: r.mensagem })
    } catch (err) {
      resultados.push({ placa, ok: false, status: 'ERRO', mensagem: err instanceof Error ? err.message : String(err) })
    }
  }

  const resolvidas = resultados.filter((r) => r.ok).length
  await logAudit({
    userId: user!.id,
    userName: user!.name,
    action: 'OMNILINK_REVALIDAR_ERROS',
    entity: 'VehiclePosition',
    entityId: 'lote',
    details: { total: resultados.length, resolvidas, resultados },
  })

  return NextResponse.json({ total: resultados.length, resolvidas, resultados })
}
