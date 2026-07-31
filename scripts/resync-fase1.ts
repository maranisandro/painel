// Recarga completa do dataset da Fase 1 (usar quando a consulta ganhar
// colunas novas — o incremental não reprocessa linhas antigas).
// Uso: npx tsx scripts/resync-fase1.ts
import 'dotenv/config'
import { prisma } from '../src/lib/prisma'
import { syncDataset } from '../src/lib/sync/engine'

async function main() {
  const dataset = await prisma.dataset.findUniqueOrThrow({
    where: { code: 'fase1_vendas_transporte' },
  })
  const removed = await prisma.datasetRow.deleteMany({ where: { datasetId: dataset.id } })
  await prisma.dataset.update({ where: { id: dataset.id }, data: { watermark: null } })
  console.log(`Cache limpo (${removed.count} linhas). Sincronizando do zero...`)
  const result = await syncDataset(dataset.id)
  console.log(`Recarga completa: ${result.rowsUpserted} linhas.`)

  const sample = await prisma.datasetRow.findFirst({ where: { datasetId: dataset.id } })
  const data = sample?.data as Record<string, unknown> | undefined
  console.log('NOME_FILIAL presente na amostra:', data?.NOME_FILIAL ?? '(ausente!)')
}

main()
  .catch((e) => {
    console.error('ERRO:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
