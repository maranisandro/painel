// Pré-carga do cadastro de Composições: para cada placa presente nos dados
// sincronizados, cria a composição de CADASTRO (effectiveFrom = null) usando
// o valor da coluna condicional TipoComposição (listas migradas do
// PowerQuery) da viagem mais recente. Só roda com o cadastro VAZIO — depois
// disso os registros pertencem ao usuário.
// Uso: npx tsx scripts/backfill-composicoes.ts
import 'dotenv/config'
import { prisma } from '../src/lib/prisma'
import { getDatasetView } from '../src/lib/semantic/dataset-view'

async function main() {
  const existing = await prisma.plateComposition.count()
  if (existing > 0) {
    console.log(`Cadastro de composições já tem ${existing} registros — backfill ignorado.`)
    return
  }

  const view = await getDatasetView('fase1_vendas_transporte')
  const latestByPlaca = new Map<string, { date: string; composition: string }>()
  for (const row of view) {
    const placa = String(row.PLACA ?? '').trim().toUpperCase()
    if (!placa) continue
    const date = String(row.DATASAIDA ?? '').slice(0, 10)
    const composition = String(row['TipoComposição'] ?? 'Outros')
    const current = latestByPlaca.get(placa)
    if (!current || date > current.date) latestByPlaca.set(placa, { date, composition })
  }

  let created = 0
  for (const [placa, info] of latestByPlaca.entries()) {
    await prisma.plateComposition.create({
      data: { placa, composition: info.composition, effectiveFrom: null },
    })
    created++
  }
  console.log(`Backfill concluído: ${created} placas com composição de cadastro.`)
}

main()
  .catch((e) => {
    console.error('ERRO:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
