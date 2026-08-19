import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, hasModuleAccess } from '@/lib/authz'
import { prisma } from '@/lib/prisma'
import { placasProprias } from '@/lib/sync/connectors/omnilink'

// Mesmo limiar usado no badge "⚠ sem comunicação" do Rastreamento
// (RastreamentoFrota.tsx) — acima disso a última posição é velha demais pra
// confiar que o veículo simplesmente não se moveu.
const LIMIAR_SEM_COMUNICACAO_MIN = 120

interface LatestPositionRow {
  placa: string
  capturedAt: Date
  localizacao: string | null
}

/**
 * Lista combinada de placas "sem rastreador" (nunca tiveram nenhuma posição
 * — Omnilink não reconhece o equipamento) e "sem comunicação" (têm posição
 * antiga demais — rastreador parou de responder) — pedido do usuário
 * 2026-08-19: "podemos trabalhar junto com estes que certamente estão
 * travados, assim trabalhamos direto com o fornecedor". Uma lista só, pronta
 * pra levar pro suporte da Omnilink.
 */
export async function GET() {
  const user = await getSessionUser()
  if (!hasModuleAccess(user, 'fase1')) return NextResponse.json({ error: 'acesso negado' }, { status: 403 })

  const [placas, ultimasPosicoes, ultimasTentativas] = await Promise.all([
    placasProprias(),
    prisma.$queryRaw<LatestPositionRow[]>`
      SELECT DISTINCT ON (placa) placa, captured_at AS "capturedAt", localizacao
      FROM vehicle_positions
      ORDER BY placa, captured_at DESC
    `,
    prisma.$queryRaw<{ placa: string; status: string; createdAt: Date }[]>`
      SELECT DISTINCT ON (placa) placa, status, created_at AS "createdAt"
      FROM omnilink_sync_placa
      ORDER BY placa, created_at DESC
    `,
  ])

  const posicaoPorPlaca = new Map(ultimasPosicoes.map((p) => [p.placa, p]))
  const tentativaPorPlaca = new Map(ultimasTentativas.map((t) => [t.placa, t]))

  const agora = Date.now()
  const resultado = placas
    .map((placa) => {
      const posicao = posicaoPorPlaca.get(placa) ?? null
      const tentativa = tentativaPorPlaca.get(placa) ?? null
      const minutosSemComunicacao = posicao ? Math.round((agora - posicao.capturedAt.getTime()) / 60_000) : null
      const situacao: 'SEM_RASTREADOR' | 'SEM_COMUNICACAO' | 'OK' = !posicao
        ? 'SEM_RASTREADOR'
        : minutosSemComunicacao !== null && minutosSemComunicacao > LIMIAR_SEM_COMUNICACAO_MIN
          ? 'SEM_COMUNICACAO'
          : 'OK'
      return {
        placa,
        situacao,
        ultimaPosicaoEm: posicao ? posicao.capturedAt.toISOString() : null,
        localizacao: posicao?.localizacao ?? null,
        minutosSemComunicacao,
        ultimoStatusSincronizacao: tentativa?.status ?? null,
        ultimaTentativaEm: tentativa ? tentativa.createdAt.toISOString() : null,
      }
    })
    // só as com problema — a lista existe pra escalar pro fornecedor, não pra auditar a frota toda
    .filter((r) => r.situacao !== 'OK')
    .sort((a, b) => (b.minutosSemComunicacao ?? Infinity) - (a.minutosSemComunicacao ?? Infinity))

  return NextResponse.json(resultado)
}
