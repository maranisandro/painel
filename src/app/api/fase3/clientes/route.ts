import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, hasModuleAccess } from '@/lib/authz'
import { getDatasetView } from '@/lib/semantic/dataset-view'
import { prepararVendas, agregarVendas, analisarClientes } from '@/lib/fase3/faturamento'

/**
 * Fase 3 — Análise de clientes: pedido original da nota Fase 3, nunca
 * implementado até 2026-08-04 ("clientes que tendem a reduzir volume de
 * compra, clientes que tem compras recorrentes e ficaram um tempo sem
 * comprar"). Usa TODO o histórico do dataset (não só um período/ano), já
 * que "parou de comprar" só faz sentido olhando o histórico completo do
 * cliente. Critérios assumidos como padrão — ver 🔶 decisão pendente na nota
 * Fase 3 do Obsidian.
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser()
  if (!hasModuleAccess(user, 'fase3')) return NextResponse.json({ error: 'acesso negado' }, { status: 403 })

  const categoriasParam = req.nextUrl.searchParams.get('categorias')
  const categoriasSelecionadas = categoriasParam ? categoriasParam.split(',').filter(Boolean) : null
  const mesReferenciaParam = req.nextUrl.searchParams.get('mesReferencia')
  const hoje = new Date()
  const mesReferencia =
    mesReferenciaParam && /^\d{4}-\d{2}$/.test(mesReferenciaParam)
      ? mesReferenciaParam
      : `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`

  let linhasTodas: ReturnType<typeof prepararVendas> = []
  try {
    const view = await getDatasetView('fase3_vendas_madeira_tratada')
    linhasTodas = prepararVendas(view, '2000-01-01', '2999-12-31')
  } catch {
    linhasTodas = []
  }

  const categoriasDisponiveis = [...new Set(linhasTodas.map((l) => l.tipoProduto))].sort()
  const porCategoria = agregarVendas(linhasTodas, (l) => l.tipoProduto)
  const linhas = categoriasSelecionadas ? linhasTodas.filter((l) => categoriasSelecionadas.includes(l.tipoProduto)) : linhasTodas

  const clientes = analisarClientes(linhas, mesReferencia)

  return NextResponse.json({
    mesReferencia,
    categoriasDisponiveis,
    porCategoria,
    totalClientes: clientes.length,
    clientesRecorrentes: clientes.filter((c) => c.recorrente).length,
    clientesParados: clientes.filter((c) => c.parado),
    clientesEmQueda: clientes.filter((c) => c.emQueda && !c.parado),
    todosClientes: clientes,
  })
}
