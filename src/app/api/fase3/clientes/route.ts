import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, hasModuleAccess } from '@/lib/authz'
import { getDatasetView } from '@/lib/semantic/dataset-view'
import { prepararVendas, agregarVendas, analisarClientes, tabelaIcmsPorEstado } from '@/lib/fase3/faturamento'
import { resolverConfigVendas } from '@/lib/fase3/cotas'
import { aplicarEscopoUsuario } from '@/lib/fase3/escopo-usuario'

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

  const config = await resolverConfigVendas()
  let linhasTodas: ReturnType<typeof prepararVendas> = []
  try {
    const view = await getDatasetView('fase3_vendas_madeira_tratada')
    linhasTodas = aplicarEscopoUsuario(prepararVendas(view, '2000-01-01', '2999-12-31', config), user!.escopoVendas)
  } catch {
    linhasTodas = []
  }

  const categoriasDisponiveis = [...new Set(linhasTodas.map((l) => l.tipoProduto))].sort()
  const porCategoria = agregarVendas(linhasTodas, (l) => l.tipoProduto)
  const linhas = categoriasSelecionadas ? linhasTodas.filter((l) => categoriasSelecionadas.includes(l.tipoProduto)) : linhasTodas

  const clientes = analisarClientes(linhas, mesReferencia)

  // Dados de cadastro do cliente (pedido do usuário 2026-09-10: "mostre
  // dados do cliente, exemplo qual a tabela de ICMS dele") — cruza pelo NOME
  // com o dataset `fase3_clientes` (mesmo padrão já usado em
  // /api/fase3/clientes-potenciais), trazendo distribuidor/cidade/estado do
  // cadastro e derivando a tabela de ICMS a partir do estado.
  let cadastroPorCliente = new Map<string, { distribuidor: string; cidade: string; codetd: string }>()
  try {
    const clientesView = await getDatasetView('fase3_clientes')
    cadastroPorCliente = new Map(
      clientesView.map((r) => [
        String(r.CLIENTE ?? '').trim(),
        {
          distribuidor: String(r.ABREV_DISTRIBUIDOR ?? 'SEM DISTRIBUIDOR'),
          cidade: String(r.CIDADE ?? '').trim(),
          codetd: String(r.CODETD ?? '').trim(),
        },
      ]),
    )
  } catch {
    cadastroPorCliente = new Map()
  }

  const clientesComCadastro = clientes.map((c) => {
    const cadastro = cadastroPorCliente.get(c.cliente)
    return {
      ...c,
      distribuidor: cadastro?.distribuidor ?? 'SEM DISTRIBUIDOR',
      cidade: cadastro?.cidade || '—',
      codetd: cadastro?.codetd || '—',
      tabelaIcms: cadastro?.codetd ? tabelaIcmsPorEstado(cadastro.codetd) : null,
    }
  })

  return NextResponse.json({
    mesReferencia,
    categoriasDisponiveis,
    porCategoria,
    totalClientes: clientesComCadastro.length,
    clientesRecorrentes: clientesComCadastro.filter((c) => c.recorrente).length,
    clientesParados: clientesComCadastro.filter((c) => c.parado),
    clientesEmQueda: clientesComCadastro.filter((c) => c.emQueda && !c.parado),
    todosClientes: clientesComCadastro,
  })
}
