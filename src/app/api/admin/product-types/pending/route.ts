import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireResourceEditor } from '@/lib/api-helpers'

/**
 * Códigos de produto (CODIGOPRD) presentes nos dados sincronizados da Fase 1
 * que ainda não têm ProductType cadastrado — para o usuário classificar
 * (Carvão/Cavaco/Maravalha/Outros/...) à medida que produtos novos aparecerem.
 */
export async function GET() {
  const auth = await requireResourceEditor('produtos')
  if ('error' in auth) return auth.error

  const dataset = await prisma.dataset.findUnique({ where: { code: 'fase1_vendas_transporte' } })
  if (!dataset) return NextResponse.json([])

  const [rows, productTypes] = await Promise.all([
    prisma.datasetRow.findMany({ where: { datasetId: dataset.id }, select: { data: true } }),
    prisma.productType.findMany({ select: { codigoPrd: true } }),
  ])

  const known = new Set(productTypes.map((p) => p.codigoPrd.trim().toUpperCase()))

  const pending = new Map<string, { codigoPrd: string; produtoNome: string; movimentos: number }>()
  for (const r of rows) {
    const data = r.data as Record<string, unknown>
    const codigo = String(data.CODIGOPRD ?? '').trim()
    if (!codigo || known.has(codigo.toUpperCase())) continue
    const entry = pending.get(codigo)
    if (entry) entry.movimentos += 1
    else pending.set(codigo, { codigoPrd: codigo, produtoNome: String(data.PRODUTO ?? '').trim(), movimentos: 1 })
  }

  return NextResponse.json([...pending.values()].sort((a, b) => b.movimentos - a.movimentos))
}
