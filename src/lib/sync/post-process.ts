import { prisma } from '@/lib/prisma'
import type { ExternalRow } from './types'

/**
 * Depois de sincronizar `fase1_custos_transporte`, transforma o bloco
 * totais.porMes (cada linha: {mes, chave, valor}) em Parameter
 * `CUSTO_MES_<ano><mês>` — pedido do usuário 2026-07-30.
 *  - `chave` vem como "02/fev" — os 2 primeiros dígitos são o mês.
 *  - Ano fixo em 2026 por enquanto: a API não distingue ano nenhum, o
 *    usuário vai pedir para considerar o ano quando isso mudar.
 *  - `valor` vem negativo (convenção contábil da Controladoria) — vira
 *    positivo (convenção do painel, ex. CUSTO_TOTAL_MES).
 *  - Só cria/atualiza meses com valor <> 0 (meses zerados não têm
 *    lançamento ainda e não devem virar parâmetro fantasma).
 *  - Nome do parâmetro carrega a data/hora da atualização, já que a tela de
 *    Parâmetros não mostra `updatedAt`.
 */
const ANO_ATUAL = '2026'

export async function processCustosTransporteRodoviario(rows: ExternalRow[]): Promise<void> {
  const atualizadoEm = new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  })
  for (const row of rows) {
    const chave = String(row.chave ?? '').trim() // ex.: "02/fev"
    const mesAbrev = String(row.mes ?? '').trim() // ex.: "FEV"
    const mesNum = chave.split('/')[0]
    const valor = Number(row.valor) || 0
    if (valor === 0 || !/^\d{2}$/.test(mesNum)) continue

    const code = `CUSTO_MES_${ANO_ATUAL}${mesNum}`
    const valorPositivo = Math.abs(valor)
    const name = `Custo transporte rodoviário ${mesNum}/${ANO_ATUAL} (${mesAbrev}) — atualizado ${atualizadoEm}`
    const description = 'Custo real (Caderno Gerencial, API Controladoria) — sincronizado automaticamente a cada hora.'

    await prisma.parameter.upsert({
      where: { code },
      update: { name, description, valueNumber: valorPositivo },
      create: { code, name, description, valueNumber: valorPositivo },
    })
  }
}

/** Passos extras específicos por dataset, executados após o sync bater com sucesso. */
export const POST_SYNC_PROCESSORS: Record<string, (rows: ExternalRow[]) => Promise<void>> = {
  fase1_custos_transporte: processCustosTransporteRodoviario,
}
