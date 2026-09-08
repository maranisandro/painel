// Copia o CACHE de sincronização (dataset_rows) de PRODUÇÃO pro ambiente
// local, sem tocar no Oracle/webservices — pedido do usuário 2026-09-08:
// "para evitar ir a todo momento no BD e nos WS", já que hoje dev e produção
// sincronizam cada um por conta própria contra as mesmas fontes externas,
// dobrando a carga (e as credenciais usadas) nelas à toa.
//
// Só copia o CONTEÚDO já sincronizado (dataset_rows) — a configuração de
// cada dataset (query, incrementalField, primaryKeyFields etc.) continua
// vindo do prisma/seed.ts local, como sempre. Os UUIDs de `datasets.id` são
// DIFERENTES entre produção e dev (cada ambiente rodou o próprio seed), então
// a cópia é sempre resolvida pelo `code` (chave estável), nunca pelo id bruto.
//
// Requer acesso SSH ao servidor de produção (mesma chave usada no deploy).
// Uso:
//   npx tsx scripts/sync-datasets-from-prod.ts                  (todos os datasets ativos)
//   npx tsx scripts/sync-datasets-from-prod.ts fase3_vendas_madeira_tratada fase3_clientes
import 'dotenv/config'
import { execFileSync } from 'node:child_process'
import { prisma } from '../src/lib/prisma'

const SSH_HOST = process.env.PROD_SSH_HOST ?? 'operador@10.10.2.60'
const SSH_KEY = process.env.PROD_SSH_KEY // opcional — se ausente, usa o ssh-agent/~/.ssh/config do usuário
const PG_CONTAINER = process.env.PROD_PG_CONTAINER ?? 'paineis_postgres'
const PG_USER = process.env.PROD_PG_USER ?? 'paineis'
const PG_DB = process.env.PROD_PG_DB ?? 'paineis_db'

const CODE_RE = /^[a-z0-9_]+$/

function psqlProd(sql: string): string {
  const remoteCmd = `docker exec ${PG_CONTAINER} psql -U ${PG_USER} -d ${PG_DB} -t -A -c "${sql.replace(/"/g, '\\"')}"`
  const args = SSH_KEY ? ['-i', SSH_KEY, SSH_HOST, remoteCmd] : [SSH_HOST, remoteCmd]
  return execFileSync('ssh', args, { maxBuffer: 1024 * 1024 * 1024, encoding: 'utf8' })
}

function linhasNaoVazias(saida: string): string[] {
  return saida.split('\n').map((l) => l.trim()).filter(Boolean)
}

async function syncOneDataset(code: string): Promise<void> {
  const local = await prisma.dataset.findUnique({ where: { code } })
  if (!local) {
    console.log(`[${code}] não existe localmente (rode "npm run db:seed" primeiro) — pulando.`)
    return
  }

  const ndjson = psqlProd(
    `SELECT json_build_object('pk', dr.pk, 'data', dr.data, 'syncedAt', dr.synced_at) ` +
      `FROM dataset_rows dr JOIN datasets d ON d.id = dr.dataset_id WHERE d.code = '${code}'`,
  )
  const linhas = linhasNaoVazias(ndjson)
  console.log(`[${code}] ${linhas.length} linhas em produção — copiando...`)

  const BATCH = 500
  let upserted = 0
  for (let i = 0; i < linhas.length; i += BATCH) {
    const slice = linhas.slice(i, i + BATCH)
    await prisma.$transaction(
      slice.map((linha) => {
        const row = JSON.parse(linha) as { pk: string; data: unknown; syncedAt: string }
        return prisma.datasetRow.upsert({
          where: { datasetId_pk: { datasetId: local.id, pk: row.pk } },
          create: { datasetId: local.id, pk: row.pk, data: row.data as object, syncedAt: new Date(row.syncedAt) },
          update: { data: row.data as object, syncedAt: new Date(row.syncedAt) },
        })
      }),
      { timeout: 60_000 },
    )
    upserted += slice.length
    process.stdout.write(`\r[${code}] ${upserted}/${linhas.length}`)
  }
  console.log(`\n[${code}] concluído: ${upserted} linhas.`)
}

async function main() {
  const codesArg = process.argv.slice(2)
  for (const c of codesArg) {
    if (!CODE_RE.test(c)) throw new Error(`Código de dataset inválido: "${c}"`)
  }

  const filtro = codesArg.length ? ` AND code IN (${codesArg.map((c) => `'${c}'`).join(',')})` : ''
  const codesRaw = psqlProd(`SELECT code FROM datasets WHERE active = true${filtro} ORDER BY code`)
  const codes = linhasNaoVazias(codesRaw)
  if (codes.length === 0) {
    console.log('Nenhum dataset encontrado em produção com esse filtro.')
    return
  }
  console.log(`Datasets a copiar: ${codes.join(', ')}\n`)

  for (const code of codes) {
    await syncOneDataset(code)
  }
}

main()
  .catch((e) => {
    console.error('ERRO:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
