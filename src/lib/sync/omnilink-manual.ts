import { prisma } from '@/lib/prisma'
import { fetchPosicoesDaPlaca } from './connectors/omnilink'
import { processOmnilinkPosicoes } from './post-process'

/**
 * Busca sob demanda a posição de UMA placa específica, fora do ciclo normal
 * de sincronização — pedido do usuário 2026-08-17: "tentar os que estão a
 * muito tempo parado individualmente" (achado real: placas aparecendo "no
 * local: Palmyra há 297h", ambíguo entre problema mecânico real e rastreador
 * que parou de comunicar). Janela fixa de 6h (não depende da marca d'água do
 * dataset) para sempre ser uma checagem "agora" — se voltar vazio, o
 * rastreador realmente não respondeu nas últimas 6h.
 */
export async function buscarPosicaoIndividual(placa: string): Promise<{
  ok: boolean
  status: 'OK' | 'NAO_LOCALIZADA' | 'ERRO'
  rowsRecebidas: number
  ultimaPosicaoEm: string | null
  mensagem: string | null
}> {
  const placaNorm = placa.trim().toUpperCase()
  const dataset = await prisma.dataset.findUnique({
    where: { code: 'fase1_omnilink_posicoes' },
    include: { dataSource: true },
  })
  if (!dataset) {
    return { ok: false, status: 'ERRO', rowsRecebidas: 0, ultimaPosicaoEm: null, mensagem: 'Dataset fase1_omnilink_posicoes não encontrado' }
  }

  const fim = new Date()
  const inicio = new Date(fim.getTime() - 6 * 3_600_000)
  const resultado = await fetchPosicoesDaPlaca(dataset.dataSource, placaNorm, inicio, fim)

  let ultimaPosicaoEm: Date | null = null
  for (const row of resultado.linhas) {
    if (!row._capturedAtIso) continue
    const d = new Date(String(row._capturedAtIso))
    if (!ultimaPosicaoEm || d > ultimaPosicaoEm) ultimaPosicaoEm = d
  }

  if (resultado.linhas.length > 0) await processOmnilinkPosicoes(resultado.linhas)

  await prisma.omnilinkSyncPlaca.create({
    data: {
      placa: placaNorm,
      status: resultado.status,
      rowsRecebidas: resultado.linhas.length,
      ultimaPosicaoEm,
      mensagem: resultado.mensagem,
      manual: true,
    },
  })

  return {
    ok: resultado.status !== 'ERRO',
    status: resultado.status,
    rowsRecebidas: resultado.linhas.length,
    ultimaPosicaoEm: ultimaPosicaoEm ? ultimaPosicaoEm.toISOString() : null,
    mensagem: resultado.mensagem,
  }
}
