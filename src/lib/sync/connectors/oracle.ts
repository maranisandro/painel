import type { DataSource, Dataset } from '@prisma/client'
import { type Connector, type ExternalRow, envFor, wrapIncremental } from '../types'
import { utcParaBrasiliaDataHora } from '@/lib/horario-brasil'

/**
 * A marca d'água é extraída via `Date.toISOString()` (sempre UTC — ver
 * `extractWatermark` em engine.ts), mas as colunas `DATE` do Oracle (RM.TMOV,
 * RM.TITMMOV etc.) não têm timezone e guardam o horário local de Brasília
 * (confirmado: SESSIONTIMEZONE/DBTIMEZONE = -03:00). Comparar o literal UTC
 * direto contra a coluna local deslocava o corte incremental 3h para frente,
 * fazendo o sync ignorar notas fiscais modificadas nesse intervalo — achado
 * real 2026-08-13, motivado pelo relato do usuário de uma venda do dia que
 * não apareceu no painel mesmo após sincronizar.
 */
function oracleLiteral(dataset: Dataset, watermark: string): string {
  switch (dataset.incrementalType) {
    case 'DATE':
      return `TO_DATE('${utcParaBrasiliaDataHora(`${watermark} 00:00:00`).slice(0, 10)}', 'YYYY-MM-DD')`
    case 'DATETIME':
      return `TO_DATE('${utcParaBrasiliaDataHora(watermark)}', 'YYYY-MM-DD HH24:MI:SS')`
    default:
      return String(Number(watermark))
  }
}

export const oracleConnector: Connector = {
  async fetchRows(source: DataSource, dataset: Dataset, watermark: string | null): Promise<ExternalRow[]> {
    // Import dinâmico: oracledb tem binário nativo e só é carregado quando usado
    const oracledb = (await import('oracledb')).default
    oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT

    let sql = dataset.query
    if (watermark && dataset.incrementalField) {
      sql = wrapIncremental(sql, dataset.incrementalField, oracleLiteral(dataset, watermark))
    }

    const connection = await oracledb.getConnection({
      user: envFor(source, 'USER'),
      password: envFor(source, 'PASSWORD'),
      connectString: envFor(source, 'CONNECT_STRING'),
    })
    try {
      const result = await connection.execute(sql, [], { fetchArraySize: 1000 })
      return (result.rows ?? []) as ExternalRow[]
    } finally {
      await connection.close()
    }
  },
}
