import type { DataSource, Dataset } from '@prisma/client'

export type ExternalRow = Record<string, unknown>

export interface Connector {
  /**
   * Executa a consulta do dataset na fonte externa e retorna as linhas.
   * Se `watermark` for informado, deve retornar apenas registros com
   * incrementalField > watermark (recuperação incremental).
   *
   * `syncRunId` é opcional e hoje só usado pelo conector Omnilink, para
   * registrar o detalhe por placa da sincronização (pedido do usuário
   * 2026-08-17: "log mais detalhado para as recuperações do omnilink") —
   * outros conectores simplesmente ignoram o parâmetro.
   */
  fetchRows(source: DataSource, dataset: Dataset, watermark: string | null, syncRunId?: string): Promise<ExternalRow[]>
}

/** Lê credencial da fonte a partir do prefixo de env cadastrado. */
export function envFor(source: DataSource, suffix: string): string {
  const key = `${source.envPrefix}_${suffix}`
  const value = process.env[key]
  if (!value) throw new Error(`Variável de ambiente ausente: ${key}`)
  return value
}

/**
 * Envolve a consulta base com o filtro incremental. Funciona em Oracle e
 * MySQL por usar subconsulta; `literal` já deve vir formatado pelo conector.
 */
export function wrapIncremental(query: string, field: string, literal: string): string {
  return `SELECT * FROM (${query}) W_INC WHERE W_INC.${field} > ${literal}`
}
