import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { fetchPosicoesDaPlaca, placasProprias } from './connectors/omnilink'
import { RETENCAO_DIAS, upsertPosicaoOmnilink } from './post-process'

/**
 * Backfill do histórico de posições GPS da Omnilink, rodando em produção
 * dentro do cron de 1 em 1 minuto (`/api/cron/sync`) — pedido do usuário
 * 2026-09-25: "tentar buscar de hora em hora deixando este processo em
 * background ... colocar no servidor de produção e deixar ele rodando, visto
 * que o servidor de dev para constantemente".
 *
 * Histórico do problema (2026-09-24): o backfill rodado como script na
 * máquina de dev (a) gravava só no banco de DEV (`.env` local aponta para
 * localhost) e (b) caía junto com a máquina (pressão de memória, Node
 * removido); janelas de 10 dias ainda estouravam o timeout de 120s nas
 * placas mais movimentadas.
 *
 * Desenho (aprovado pelo usuário):
 *  - Placa a placa, janelas de 1h — cada resposta fica pequena.
 *  - Do presente para o passado, até `INICIO_BACKFILL` (01/09) ou o limite
 *    de retenção (`RETENCAO_DIAS`), o que for mais recente.
 *  - Poucas janelas por execução do cron (orçamento de tempo), cursor
 *    persistido em `OmnilinkBackfillPlaca` — retoma sozinho após reinício.
 *  - Janela com erro é tentada de novo na próxima execução; após
 *    `MAX_FALHAS_SEGUIDAS` a janela é registrada em `janelasComErro` e a
 *    placa segue, para uma janela ruim não travar o resto.
 *  - Só grava o rastro (`upsertPosicaoOmnilink`) — sem alerta de velocidade
 *    nem visita a local, que são efeitos pensados para o fluxo ao vivo.
 */

const JANELA_MS = 3_600_000 // 1h
// Pedido do usuário 2026-09-25: recuperar só a partir de 01/09 ("o
// restante pode desconsiderar") em vez de ir até o limite de retenção.
const INICIO_BACKFILL = new Date('2026-09-01T03:00:00Z') // 01/09 00h em Brasília
const MAX_FALHAS_SEGUIDAS = 3
const PAUSA_ENTRE_JANELAS_MS = 300
// Nova leitura da lista de placas próprias (view de vendas/transporte, cara)
// no máximo a cada 6h — pega placa nova sem pesar a cada minuto.
const INTERVALO_SEMEADURA_MS = 6 * 3_600_000

let emExecucao = false
let ultimaSemeadura = 0

export type ResultadoBackfillOmnilink = {
  janelas: number
  posicoes: number
  erros: number
  placasPendentes: number
  pulado?: string
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function semearPlacas(): Promise<void> {
  if (Date.now() - ultimaSemeadura < INTERVALO_SEMEADURA_MS) return
  const placas = await placasProprias()
  // Cursor começa na hora cheia atual: a sincronização ao vivo já cobre as
  // últimas horas, sobreposição é inofensiva (upsert idempotente).
  const cursorAt = new Date(Math.floor(Date.now() / JANELA_MS) * JANELA_MS)
  await prisma.omnilinkBackfillPlaca.createMany({
    data: placas.map((placa) => ({ placa, cursorAt })),
    skipDuplicates: true,
  })
  ultimaSemeadura = Date.now()
}

export async function executarBackfillOmnilink(orcamentoMs: number): Promise<ResultadoBackfillOmnilink> {
  const resultado: ResultadoBackfillOmnilink = { janelas: 0, posicoes: 0, erros: 0, placasPendentes: 0 }
  // Chamadas do cron podem se sobrepor quando a sincronização + backfill
  // passam de 1 min — um backfill por vez neste processo.
  if (emExecucao) return { ...resultado, pulado: 'backfill anterior ainda em execução' }
  if (orcamentoMs <= 0) return { ...resultado, pulado: 'sem tempo nesta execução' }
  emExecucao = true
  const prazo = Date.now() + orcamentoMs
  try {
    await semearPlacas()
    const source = await prisma.dataSource.findFirst({ where: { envPrefix: 'OMNILINK_API' } })
    if (!source) return { ...resultado, pulado: 'DataSource Omnilink não encontrada' }

    while (Date.now() < prazo) {
      const item = await prisma.omnilinkBackfillPlaca.findFirst({
        where: { status: 'PENDENTE' },
        orderBy: [{ createdAt: 'asc' }, { placa: 'asc' }],
      })
      if (!item) break

      const limite = new Date(Math.max(Date.now() - RETENCAO_DIAS * 86_400_000, INICIO_BACKFILL.getTime()))
      if (item.cursorAt <= limite) {
        await prisma.omnilinkBackfillPlaca.update({
          where: { id: item.id },
          data: { status: 'CONCLUIDA', concluidaEm: new Date() },
        })
        continue
      }

      const ate = item.cursorAt
      const de = new Date(Math.max(ate.getTime() - JANELA_MS, limite.getTime()))
      const resposta = await fetchPosicoesDaPlaca(source, item.placa, de, ate)
      resultado.janelas++

      if (resposta.status === 'NAO_LOCALIZADA') {
        await prisma.omnilinkBackfillPlaca.update({
          where: { id: item.id },
          data: { status: 'NAO_LOCALIZADA', concluidaEm: new Date() },
        })
        continue
      }

      if (resposta.status === 'ERRO') {
        resultado.erros++
        const falhas = item.falhasSeguidas + 1
        if (falhas >= MAX_FALHAS_SEGUIDAS) {
          const janelas = Array.isArray(item.janelasComErro) ? (item.janelasComErro as Prisma.JsonArray) : []
          await prisma.omnilinkBackfillPlaca.update({
            where: { id: item.id },
            data: {
              cursorAt: de,
              falhasSeguidas: 0,
              ultimoErro: resposta.mensagem,
              janelasComErro: [...janelas, { de: de.toISOString(), ate: ate.toISOString(), erro: resposta.mensagem }],
            },
          })
        } else {
          await prisma.omnilinkBackfillPlaca.update({
            where: { id: item.id },
            data: { falhasSeguidas: falhas, ultimoErro: resposta.mensagem },
          })
        }
        // API com problema (timeout, rate limit): para por esta execução em
        // vez de insistir em rajada; próxima execução do cron tenta de novo.
        break
      }

      let gravadas = 0
      for (const row of resposta.linhas) {
        if (await upsertPosicaoOmnilink(row)) gravadas++
      }
      resultado.posicoes += gravadas
      await prisma.omnilinkBackfillPlaca.update({
        where: { id: item.id },
        data: { cursorAt: de, falhasSeguidas: 0, posicoesGravadas: { increment: gravadas } },
      })
      await sleep(PAUSA_ENTRE_JANELAS_MS)
    }

    resultado.placasPendentes = await prisma.omnilinkBackfillPlaca.count({ where: { status: 'PENDENTE' } })
    if (resultado.janelas > 0) {
      console.log(
        `[omnilink-backfill] ${resultado.janelas} janela(s), ${resultado.posicoes} posição(ões), ${resultado.erros} erro(s), ${resultado.placasPendentes} placa(s) pendente(s)`,
      )
    }
    return resultado
  } finally {
    emExecucao = false
  }
}
