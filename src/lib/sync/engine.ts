import type { Dataset, DataSource } from '@prisma/client'
import { Client } from 'pg'
import { prisma } from '@/lib/prisma'
import { type Connector, type ExternalRow } from './types'
import { oracleConnector } from './connectors/oracle'
import { mysqlConnector } from './connectors/mysql'
import { webserviceConnector } from './connectors/webservice'
import { POST_SYNC_PROCESSORS } from './post-process'

const connectors: Record<string, Connector> = {
  ORACLE: oracleConnector,
  MYSQL: mysqlConnector,
  WEBSERVICE: webserviceConnector,
}

export class SyncAlreadyRunningError extends Error {
  constructor() {
    super('Este dataset já está sendo sincronizado. Aguarde a execução atual terminar.')
    this.name = 'SyncAlreadyRunningError'
  }
}

export function getPublicSyncError(err: unknown): string {
  if (err instanceof SyncAlreadyRunningError) return err.message
  return 'Falha na sincronização. Consulte o detalhe da última execução na tela de Datasets.'
}

async function withDatasetAdvisoryLock<T>(datasetId: string, action: () => Promise<T>): Promise<T> {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('Variável de ambiente DATABASE_URL ausente')

  const client = new Client({ connectionString })
  await client.connect()
  let locked = false
  try {
    const result = await client.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock(
        hashtext('paineis:dataset-sync'),
        hashtext($1)
      ) AS locked`,
      [datasetId],
    )
    locked = result.rows[0]?.locked === true
    if (!locked) throw new SyncAlreadyRunningError()
    return await action()
  } finally {
    if (locked) {
      await client.query(
        `SELECT pg_advisory_unlock(
          hashtext('paineis:dataset-sync'),
          hashtext($1)
        )`,
        [datasetId],
      )
    }
    await client.end()
  }
}

function buildPk(row: ExternalRow, pkFields: string[]): string {
  return pkFields.map((f) => String(row[f] ?? '')).join('|')
}

function extractWatermark(rows: ExternalRow[], dataset: Dataset): string | null {
  if (!dataset.incrementalField || rows.length === 0) return null
  let max: string | null = null
  for (const row of rows) {
    const raw = row[dataset.incrementalField]
    if (raw === null || raw === undefined) continue
    let value: string
    if (raw instanceof Date) {
      value =
        dataset.incrementalType === 'DATE'
          ? raw.toISOString().slice(0, 10)
          : raw.toISOString().slice(0, 19).replace('T', ' ')
    } else {
      value = String(raw)
    }
    if (max === null || value > max) max = value
  }
  return max
}

/**
 * Sincroniza um dataset: busca na fonte externa (incremental quando o
 * dataset tem campo de marca d'água), faz upsert no cache local e registra
 * a execução em SyncRun.
 */
async function syncDatasetUnlocked(datasetId: string): Promise<{ rowsUpserted: number }> {
  const dataset = await prisma.dataset.findUniqueOrThrow({
    where: { id: datasetId },
    include: { dataSource: true },
  })

  const run = await prisma.syncRun.create({
    data: { datasetId: dataset.id, watermarkBefore: dataset.watermark },
  })

  try {
    const connector = connectors[dataset.dataSource.type]
    if (!connector) throw new Error(`Tipo de fonte sem conector: ${dataset.dataSource.type}`)

    // Cada etapa recebe um prefixo no erro para o admin saber ONDE falhou
    // (busca na fonte externa × gravação no cache local) sem precisar olhar
    // o servidor — pedido do usuário: detalhar o erro de sincronização.
    let rows: ExternalRow[]
    try {
      rows = await connector.fetchRows(dataset.dataSource as DataSource, dataset, dataset.watermark)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`Falha ao buscar dados em "${dataset.dataSource.name}" (${dataset.dataSource.type}): ${msg}`)
    }
    const pkFields = dataset.primaryKeyFields.split(',').map((s) => s.trim()).filter(Boolean)

    let upserted = 0
    // Upsert em lotes dentro de transações para não estourar memória/conexões
    const BATCH = 500
    try {
      for (let i = 0; i < rows.length; i += BATCH) {
        const slice = rows.slice(i, i + BATCH)
        await prisma.$transaction(
          slice.map((row) =>
            prisma.datasetRow.upsert({
              where: { datasetId_pk: { datasetId: dataset.id, pk: buildPk(row, pkFields) } },
              create: {
                datasetId: dataset.id,
                pk: buildPk(row, pkFields),
                data: row as object,
              },
              update: { data: row as object, syncedAt: new Date() },
            }),
          ),
          // Timeout padrão (5s) estourava em lotes de 500 quando o dataset é
          // grande (ex.: abastecimento, ~41 mil linhas) — 500 upserts
          // sequenciais numa transação passam de 5s em conexões mais lentas.
          { timeout: 60_000 },
        )
        upserted += slice.length
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(
        `Falha ao gravar no cache local (lote ${Math.floor(upserted / BATCH) + 1} de ${Math.ceil(rows.length / BATCH)}, ${upserted} de ${rows.length} linhas já gravadas): ${msg}`,
      )
    }

    // Passo extra específico do dataset (ex.: fase1_custos_transporte vira
    // parâmetros CUSTO_MES_*) — roda depois do cache local gravar com
    // sucesso, mas ainda dentro do sync (falha aqui também marca o
    // SyncRun como ERROR, já que o usuário espera o parâmetro atualizado).
    const postProcess = POST_SYNC_PROCESSORS[dataset.code]
    if (postProcess) {
      try {
        await postProcess(rows)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        throw new Error(`Falha no pós-processamento de "${dataset.name}": ${msg}`)
      }
    }

    const newWatermark = extractWatermark(rows, dataset) ?? dataset.watermark

    await prisma.dataset.update({
      where: { id: dataset.id },
      data: { watermark: newWatermark },
    })
    await prisma.syncRun.update({
      where: { id: run.id },
      data: {
        status: 'SUCCESS',
        finishedAt: new Date(),
        rowsUpserted: upserted,
        watermarkAfter: newWatermark,
      },
    })
    return { rowsUpserted: upserted }
  } catch (err) {
    await prisma.syncRun.update({
      where: { id: run.id },
      data: {
        status: 'ERROR',
        finishedAt: new Date(),
        error: err instanceof Error ? err.message : String(err),
      },
    })
    throw err
  }
}

export async function syncDataset(datasetId: string): Promise<{ rowsUpserted: number }> {
  return withDatasetAdvisoryLock(datasetId, () => syncDatasetUnlocked(datasetId))
}

/** Executa todas as agendas vencidas (chamado pelo endpoint de cron). */
export async function runDueSchedules(): Promise<{ datasetId: string; ok: boolean; error?: string }[]> {
  const now = new Date()
  const due = await prisma.syncSchedule.findMany({
    where: {
      enabled: true,
      dataset: { active: true },
      OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }],
    },
    include: { dataset: true },
  })

  const results: { datasetId: string; ok: boolean; error?: string }[] = []
  for (const schedule of due) {
    try {
      await syncDataset(schedule.datasetId)
      results.push({ datasetId: schedule.datasetId, ok: true })
    } catch (err) {
      results.push({
        datasetId: schedule.datasetId,
        ok: false,
        error: getPublicSyncError(err),
      })
    }
    await prisma.syncSchedule.update({
      where: { id: schedule.id },
      data: {
        lastRunAt: new Date(),
        nextRunAt: new Date(Date.now() + schedule.intervalMinutes * 60_000),
      },
    })
  }
  return results
}
