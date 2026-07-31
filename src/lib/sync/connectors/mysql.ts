import type { DataSource, Dataset } from '@prisma/client'
import { type Connector, type ExternalRow, envFor, wrapIncremental } from '../types'

function mysqlLiteral(dataset: Dataset, watermark: string): string {
  switch (dataset.incrementalType) {
    case 'DATE':
    case 'DATETIME':
      return `'${watermark.replace(/'/g, '')}'`
    default:
      return String(Number(watermark))
  }
}

export const mysqlConnector: Connector = {
  async fetchRows(source: DataSource, dataset: Dataset, watermark: string | null): Promise<ExternalRow[]> {
    const mysql = await import('mysql2/promise')

    let sql = dataset.query
    if (watermark && dataset.incrementalField) {
      sql = wrapIncremental(sql, dataset.incrementalField, mysqlLiteral(dataset, watermark))
    }

    const config = (source.config ?? {}) as { host?: string; port?: number; database?: string }
    const connection = await mysql.createConnection({
      host: config.host ?? 'localhost',
      port: config.port ?? 3306,
      database: config.database,
      user: envFor(source, 'USER'),
      password: envFor(source, 'PASSWORD'),
    })
    try {
      const [rows] = await connection.query(sql)
      return rows as ExternalRow[]
    } finally {
      await connection.end()
    }
  },
}
