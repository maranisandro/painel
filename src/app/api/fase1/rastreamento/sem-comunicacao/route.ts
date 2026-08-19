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
 * Situação de comunicação de TODA a frota própria (não só as com problema) —
 * "sem rastreador" (nunca tiveram nenhuma posição), "sem comunicação" (têm
 * posição antiga demais) ou "OK". Pedido do usuário 2026-08-19: "podemos
 * trabalhar junto com estes que certamente estão travados, assim trabalhamos
 * direto com o fornecedor". A aba "Sem comunicação" do Rastreamento filtra
 * pra fora as "OK" no cliente (`?situacao=todas` devolve tudo, usado pelo
 * acompanhamento de Tritrem Florestal, que precisa saber a última posição
 * mesmo de quem está em dia).
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser()
  if (!hasModuleAccess(user, 'fase1')) return NextResponse.json({ error: 'acesso negado' }, { status: 403 })

  const [placas, ultimasPosicoes, ultimasTentativas] = await Promise.all([
    placasProprias(),
    prisma.$queryRaw<LatestPositionRow[]>`
      SELECT DISTINCT ON (placa) placa, captured_at AS "capturedAt", localizacao
      FROM vehicle_positions
      ORDER BY placa, captured_at DESC
    `,
    prisma.$queryRaw<{ placa: string; status: string; createdAt: Date; rowsRecebidas: number }[]>`
      SELECT DISTINCT ON (placa) placa, status, created_at AS "createdAt", rows_recebidas AS "rowsRecebidas"
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
        // Pedido do usuário 2026-08-19: "o que significa 'sem comunicação'
        // sem que houve comunicação e buscou posição?" — a sincronização
        // pode ter respondido OK sem trazer NENHUMA posição nova (rastreador
        // não gerou leitura, não é falha nossa). Sem o número de linhas
        // recebidas, "OK" ao lado de "sem comunicação" parece contraditório.
        ultimoStatusSincronizacao: tentativa?.status ?? null,
        ultimasLinhasRecebidas: tentativa?.rowsRecebidas ?? null,
        ultimaTentativaEm: tentativa ? tentativa.createdAt.toISOString() : null,
      }
    })
    .sort((a, b) => (b.minutosSemComunicacao ?? Infinity) - (a.minutosSemComunicacao ?? Infinity))

  const incluirOk = req.nextUrl.searchParams.get('situacao') === 'todas'
  return NextResponse.json(incluirOk ? resultado : resultado.filter((r) => r.situacao !== 'OK'))
}
