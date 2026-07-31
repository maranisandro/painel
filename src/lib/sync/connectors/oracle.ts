import type { DataSource, Dataset } from '@prisma/client'
import { type Connector, type ExternalRow, envFor, wrapIncremental } from '../types'

function oracleLiteral(dataset: Dataset, watermark: string): string {
  switch (dataset.incrementalType) {
    case 'DATE':
      return `TO_DATE('${watermark}', 'YYYY-MM-DD')`
    case 'DATETIME':
      return `TO_DATE('${watermark}', 'YYYY-MM-DD HH24:MI:SS')`
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
