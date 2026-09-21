import { prisma } from '@/lib/prisma'

/**
 * Retry rápido por dataset — pedido do usuário 2026-09-21: "caso apresente
 * um erro, tentar no próximo minuto" (Omnilink). Mesmo padrão de extensão
 * de `POST_SYNC_PROCESSORS` (post-process.ts): mapa por `Dataset.code`, sem
 * hardcode de dataset específico dentro do motor de sync genérico
 * (`engine.ts`). Datasets sem entrada aqui mantêm o comportamento normal
 * (próxima execução só depois do `intervalMinutes` cheio).
 */
export const RETRY_RAPIDO_MS = 60_000

/**
 * O conector do Omnilink (`fetchOmnilinkPosicoes`) absorve erro de placa
 * individual — não deixa uma placa com problema (token, rede, TLS) derrubar
 * a sincronização inteira das outras. Isso significa que o `SyncRun`
 * termina como SUCCESS mesmo quando alguma placa falhou; a única forma de
 * saber que houve erro parcial é olhar o `OmnilinkSyncPlaca` da execução
 * mais recente.
 */
async function omnilinkTeveErroParcial(datasetId: string): Promise<boolean> {
  const run = await prisma.syncRun.findFirst({ where: { datasetId }, orderBy: { startedAt: 'desc' } })
  if (!run) return false
  const erro = await prisma.omnilinkSyncPlaca.findFirst({ where: { syncRunId: run.id, status: 'ERRO' } })
  return erro != null
}

const VERIFICAR_ERRO_PARCIAL: Record<string, (datasetId: string) => Promise<boolean>> = {
  fase1_omnilink_posicoes: omnilinkTeveErroParcial,
}

/** Verifica, depois de um `SyncRun` bem-sucedido, se houve erro parcial que justifica retry rápido em vez do intervalo normal. */
export async function teveErroParcial(datasetCode: string, datasetId: string): Promise<boolean> {
  const verificar = VERIFICAR_ERRO_PARCIAL[datasetCode]
  return verificar ? verificar(datasetId) : false
}
