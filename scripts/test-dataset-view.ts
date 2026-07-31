// Testa a visão semântica (colunas condicionais + lookup) sobre dados reais.
// Uso: npx tsx scripts/test-dataset-view.ts
import 'dotenv/config'
import { getDatasetView } from '../src/lib/semantic/dataset-view'
import { prisma } from '../src/lib/prisma'

async function main() {
  const view = await getDatasetView('fase1_vendas_transporte')
  console.log('Total de linhas na visão:', view.length)

  // Distribuição das colunas calculadas
  for (const col of ['TipoProduto', 'UPC', 'TipoComposição', 'Consolida Transportadora']) {
    const dist = new Map<string, number>()
    for (const row of view) {
      const v = String(row[col] ?? 'null')
      dist.set(v, (dist.get(v) ?? 0) + 1)
    }
    console.log(`\n${col}:`)
    for (const [v, n] of [...dist.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${v}: ${n}`)
    }
  }

  // Amostra de 2 linhas com transportadora resolvida
  const sample = view.filter((r) => r.TransportadoraNome).slice(0, 2)
  for (const r of sample) {
    console.log('\nAmostra:', {
      PLACA: r.PLACA,
      PRODUTO: r.PRODUTO,
      TipoProduto: r.TipoProduto,
      UPC: r.UPC,
      TransportadoraNome: r.TransportadoraNome,
      Consolida: r['Consolida Transportadora'],
    })
  }
}

main()
  .catch((e) => {
    console.error('ERRO:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
