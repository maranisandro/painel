import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, hasModuleAccess } from '@/lib/authz'
import { getDatasetView } from '@/lib/semantic/dataset-view'
import {
  prepararVendas,
  agregarVendas,
  produtosAoLongoDoTempo,
  dispersaoPrecoPorProdutoTabela,
  vendasAbaixoTabela4,
  DISTRIBUIDORES_CONHECIDOS,
} from '@/lib/fase3/faturamento'
import { carregarMetaPeriodo, compararComCotas, carregarNomesClientes, calcularInsightDiametroMourao } from '@/lib/fase3/cotas'
import { hojeBrasil, corteOficial } from '@/lib/horario-brasil'

function monthStart(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

/**
 * Fase 3 — Vendas de madeira tratada: perda de preço por distribuidor,
 * tipo de produto e tabela de ICMS. Query: from/to (YYYY-MM-DD, default mês
 * atual), mesmo padrão de /api/fase1/data.
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser()
  if (!hasModuleAccess(user, 'fase3')) return NextResponse.json({ error: 'acesso negado' }, { status: 403 })

  const from = req.nextUrl.searchParams.get('from') || monthStart()
  const to = req.nextUrl.searchParams.get('to') || hojeBrasil()
  // Corte D-1/18h (pedido do usuário 2026-08-13): o comparativo OFICIAL (KPIs,
  // tabelas, comparativo de cotas) usa `toOficial`, que fica em D-1 até as
  // 18h — hoje ainda pode ganhar vendas/NFs lançadas ao longo do dia. Depois
  // das 18h, ou quando o usuário navega para um período já fechado no
  // passado, `toOficial` vira o próprio `to`. `linhasHoje` (abaixo) mostra o
  // dia de hoje à parte, sempre, para acompanhamento — sem isso uma viagem/
  // venda de hoje "sumiria" do painel até o corte liberar.
  const toOficial = corteOficial(to)
  const categoriasParam = req.nextUrl.searchParams.get('categorias')
  const categoriasSelecionadas = categoriasParam ? categoriasParam.split(',').filter(Boolean) : null
  // Cards clicáveis (pedido do usuário 2026-08-05: "os cards precisam estar
  // nas abas de análise por período e no estratégico com os mesmos
  // conceitos") — mesmo filtro de ICMS/Mourão-Peças já usado no estratégico.
  const tabelasParam = req.nextUrl.searchParams.get('tabelas')
  const tabelasSelecionadas = tabelasParam ? tabelasParam.split(',').filter(Boolean) : null
  const subTiposParam = req.nextUrl.searchParams.get('subtipos')
  const subTiposSelecionados = subTiposParam ? subTiposParam.split(',').filter(Boolean) : null
  // Filtro superior de Marca AMARU x STANDARD (pedido do usuário 2026-08-13:
  // "no topo criar um filtro de AMARU e STANDRT, isto é definido no nome do
  // produto") — mesmo ComputedColumn `Marca` já existente, exposto como
  // filtro de checkbox no topo do painel, igual à categoria.
  const marcasParam = req.nextUrl.searchParams.get('marcas')
  const marcasSelecionadas = marcasParam ? marcasParam.split(',').filter(Boolean) : null
  // Filtro por cliente em combo de pesquisa (pedido do usuário 2026-08-05:
  // "no painel mensal e estratégico colocar um filtro por cliente em um
  // combo de pesquisa") — seleção única, não em lista de checkbox como
  // categoria, porque o universo de clientes chega a milhares.
  const clienteParam = req.nextUrl.searchParams.get('cliente')
  const clienteSelecionado = clienteParam ? clienteParam.trim() : null
  // Cards do resumo financeiro clicáveis (pedido do usuário 2026-08-13):
  // clicar em Bruto/Bonificação/Devolução filtra TODO o restante da tela
  // (KPIs, gráfico diário, tabelas) para só aquele tipo de movimento — feito
  // cedo, direto em cima de linhasPeriodo/linhasHoje, pro corte valer pra
  // tudo que vem depois (mesmo espírito de categoriasSelecionadas, mas
  // aplicado antes por não ser um recorte exploratório e sim um tipo de
  // lançamento diferente).
  const tipoMovimentoParam = req.nextUrl.searchParams.get('tipoMovimento')
  const tipoMovimentoSelecionado = tipoMovimentoParam ? tipoMovimentoParam.split(',').filter(Boolean) : null

  let view: Awaited<ReturnType<typeof getDatasetView>> = []
  try {
    view = await getDatasetView('fase3_vendas_madeira_tratada')
  } catch {
    view = [] // dataset ainda não sincronizado
  }
  const linhasPeriodoTodosMovimentos = prepararVendas(view, from, toOficial)
  const linhasPeriodo = tipoMovimentoSelecionado
    ? linhasPeriodoTodosMovimentos.filter((l) => tipoMovimentoSelecionado.includes(l.tipoMovimento))
    : linhasPeriodoTodosMovimentos

  // "Hoje" — acompanhamento à parte (pedido do usuário 2026-08-13): mesmo
  // com hoje fora do comparativo oficial (antes das 18h), o dia continua
  // visível aqui para quem quer saber "o que já vendemos hoje" sem esperar
  // o corte liberar.
  const hojeStr = hojeBrasil()
  const linhasHojeTodosMovimentos = to >= hojeStr ? prepararVendas(view, hojeStr, hojeStr) : []
  const linhasHoje = tipoMovimentoSelecionado
    ? linhasHojeTodosMovimentos.filter((l) => tipoMovimentoSelecionado.includes(l.tipoMovimento))
    : linhasHojeTodosMovimentos
  const hojeIncluidoNoOficial = toOficial >= hojeStr
  const hojeResumo =
    linhasHoje.length > 0 || to >= hojeStr
      ? {
          data: hojeStr,
          incluidoNoOficial: hojeIncluidoNoOficial,
          totais: agregarVendas(linhasHoje, () => 'total')[0] ?? null,
          numeroNotas: new Set(linhasHoje.map((l) => l.numeroMov).filter(Boolean)).size,
        }
      : null

  // Categorias disponíveis calculadas ANTES do filtro de categoria (mostra
  // todas as opções do período, mesmo as não selecionadas no momento) —
  // pedido do usuário 2026-08-04: "trazer todas as categorias com um filtro
  // superior por categoria, deixando o agronegócio como padrão marcado".
  const categoriasDisponiveis = [...new Set(linhasPeriodo.map((l) => l.tipoProduto))].sort()
  // Lista de clientes SEMPRE sobre linhasPeriodo (não filtrado por categoria
  // nem pelo próprio cliente já selecionado) — mesmo princípio de
  // categoriasDisponiveis: o combo de busca sempre mostra o universo inteiro
  // do período, não só o que sobrou depois de outros filtros.
  const clientesDisponiveis = [...new Set(linhasPeriodo.map((l) => l.cliente || '—'))].sort()
  const linhasCategoria = categoriasSelecionadas
    ? linhasPeriodo.filter((l) => categoriasSelecionadas.includes(l.tipoProduto))
    : linhasPeriodo
  const linhasMarca = marcasSelecionadas ? linhasCategoria.filter((l) => marcasSelecionadas.includes(l.marca)) : linhasCategoria
  const linhasClienteFiltro = clienteSelecionado
    ? linhasMarca.filter((l) => (l.cliente || '—') === clienteSelecionado)
    : linhasMarca
  // Ver /api/fase3/estrategico para o motivo de cada variante: os PRÓPRIOS
  // cards de ICMS/Mourão-Peças precisam sempre mostrar todas as opções.
  const linhasSemFiltroTabela = subTiposSelecionados
    ? linhasClienteFiltro.filter((l) => subTiposSelecionados.includes(l.subTipoProduto))
    : linhasClienteFiltro
  const linhasSemFiltroSubtipo = tabelasSelecionadas
    ? linhasClienteFiltro.filter((l) => tabelasSelecionadas.includes(l.tabelaPreco))
    : linhasClienteFiltro
  const linhas = tabelasSelecionadas
    ? linhasSemFiltroTabela.filter((l) => tabelasSelecionadas.includes(l.tabelaPreco))
    : linhasSemFiltroTabela

  const porDistribuidor = agregarVendas(linhas, (l) => l.distribuidor)
  const porProduto = agregarVendas(linhas, (l) => `${l.distribuidor}|${l.tipoProduto}|${l.tabelaPreco}`).map((a) => {
    const [distribuidor, tipoProduto, tabelaPreco] = a.chave.split('|')
    return { ...a, distribuidor, tipoProduto, tabelaPreco }
  })
  const porCliente = agregarVendas(linhas, (l) => l.cliente || '—')
  // Clientes abertos por distribuidor (pedido do usuário 2026-08-04: "abrir
  // clientes por distribuidor") + distribuidores conhecidos sem nenhuma
  // venda/cliente no período (não aparecem em porDistribuidor por não terem
  // nenhuma linha).
  const porDistribuidorCliente = agregarVendas(linhas, (l) => `${l.distribuidor}|${l.cliente || '—'}`).map((a) => {
    const [distribuidor, cliente] = a.chave.split('|')
    return { ...a, distribuidor, cliente }
  })
  const distribuidoresComVenda = new Set(porDistribuidor.map((d) => d.chave))
  const distribuidoresSemVenda = DISTRIBUIDORES_CONHECIDOS.filter((d) => !distribuidoresComVenda.has(d))
  // Produtos por cliente (pedido do usuário 2026-08-04: "no detalhamento por
  // cliente, quando estiver abaixo da meta, detalhar para sabermos qual
  // produto impacta na meta") — permite abrir cada cliente e ver qual
  // produto está puxando o preço/m³ para baixo do mínimo.
  const porClienteProduto = agregarVendas(linhas, (l) => `${l.cliente || '—'}|${l.produto}`).map((a) => {
    const [cliente, produto] = a.chave.split('|')
    return { ...a, cliente, produto }
  })
  // Detalhe por NOTA FISCAL dentro de cada cliente×produto (pedido do
  // usuário 2026-08-05: "insira a nota ou notas fiscais que o produto
  // participou e qual seria a meta de destino destas vendas") — segundo
  // nível de expansão dentro do drill-down "Por cliente", abaixo do produto.
  const dataPorNumeroMov = new Map<string, string>()
  for (const l of linhas) if (l.numeroMov && !dataPorNumeroMov.has(l.numeroMov)) dataPorNumeroMov.set(l.numeroMov, l.data)
  const porClienteProdutoNota = agregarVendas(linhas, (l) => `${l.cliente || '—'}|${l.produto}|${l.numeroMov || '—'}`).map((a) => {
    const [cliente, produto, numeroMov] = a.chave.split('|')
    return { ...a, cliente, produto, numeroMov, data: dataPorNumeroMov.get(numeroMov) ?? '' }
  })
  const porDistribuidorClienteProduto = agregarVendas(linhas, (l) => `${l.distribuidor}|${l.cliente || '—'}|${l.produto}`).map((a) => {
    const [distribuidor, cliente, produto] = a.chave.split('|')
    return { ...a, distribuidor, cliente, produto }
  })
  const porProdutoEspecifico = agregarVendas(linhas, (l) => `${l.produto}|${l.tabelaPreco}`).map((a) => {
    const [produto, tabelaPreco] = a.chave.split('|')
    return { ...a, produto, tabelaPreco }
  })
  const produtosPorMes = produtosAoLongoDoTempo(linhas)
  // Dispersão de preço por produto × ICMS (pedido do usuário 2026-08-04:
  // "mostrar produtos que têm um valor considerável de preço entre as
  // vendas de acordo com cada alíquota de ICMS") — top 30 maiores variações.
  const dispersaoPreco = dispersaoPrecoPorProdutoTabela(linhas).slice(0, 30)
  // Pedido original da nota Fase 3, nunca implementado até 2026-08-04:
  // "demonstrar quando preco_base ou preco_venda for menor do que
  // PRECO_MEDIO_TABELA4" — top 50 transações com maior valor perdido.
  const todasAbaixoTabela4 = vendasAbaixoTabela4(linhas)
  const abaixoTabela4 = todasAbaixoTabela4.slice(0, 50)
  const totalGeral = agregarVendas(linhas, () => 'total')[0] ?? null

  // Comparativo com as cotas de venda cadastradas (pedido do usuário
  // 2026-08-13) — meta soma todo mês cadastrado dentro do período `from`..`to`,
  // realizado vem das MESMAS `linhas` já filtradas (categoria/tabela/subtipo/cliente).
  const [metaPeriodo, nomesClientes] = await Promise.all([carregarMetaPeriodo(from, toOficial), carregarNomesClientes()])
  const comparativoCotas = compararComCotas(linhas, metaPeriodo, toOficial, nomesClientes)
  // Proporção 8-10/10-12 (pedido do usuário 2026-08-13, gauge do Power BI de
  // referência) — comparada com a meta cadastrada em ProductQuota para os
  // mesmos dois produtos, quando existir.
  const insightDiametroMourao = calcularInsightDiametroMourao(linhas, metaPeriodo.produtos)

  // Gráfico diário — pedido do usuário 2026-08-05: "análise por período
  // montar um gráfico por dia da média e do ponderado" — R$/m³ realmente
  // vendido (valorM3Vendido) x preço mínimo ponderado (precoPonderado, a
  // "meta") dia a dia, para enxergar a tendência dentro do período filtrado.
  //
  // Pedido do usuário 2026-08-13: "colocar no gráfico de evolução diária o
  // hoje sem impactar nas médias" — o gráfico usa `linhasParaGrafico`, que
  // inclui o dia de hoje (com os MESMOS filtros de categoria/cliente/
  // subtipo/tabela de `linhas`) mesmo quando hoje ainda está fora do
  // comparativo oficial — só para este gráfico. Todo o resto acima
  // (totalGeral, porDistribuidor, comparativoCotas, etc.) continua em cima
  // de `linhas`, sem hoje, intocado.
  const linhasHojeFiltrada = categoriasSelecionadas
    ? linhasHoje.filter((l) => categoriasSelecionadas.includes(l.tipoProduto))
    : linhasHoje
  const linhasHojeClienteFiltro = clienteSelecionado
    ? linhasHojeFiltrada.filter((l) => (l.cliente || '—') === clienteSelecionado)
    : linhasHojeFiltrada
  const linhasHojeSubTipoTabela = (subTiposSelecionados
    ? linhasHojeClienteFiltro.filter((l) => subTiposSelecionados.includes(l.subTipoProduto))
    : linhasHojeClienteFiltro
  ).filter((l) => !tabelasSelecionadas || tabelasSelecionadas.includes(l.tabelaPreco))
  const linhasParaGrafico = hojeIncluidoNoOficial ? linhas : [...linhas, ...linhasHojeSubTipoTabela]

  const porDiaBase = [...agregarVendas(linhasParaGrafico, (l) => l.data)].sort((a, b) => a.chave.localeCompare(b.chave))

  // Volume por dia × tipo de produto, mesclado no MESMO objeto de porDia
  // (pedido do usuário 2026-08-05: "colocar uma barra de volume vendido por
  // dia, barra empilhada por cor por tipo" e depois "queria que fosse
  // inserido no mesmo gráfico com uma segunda série/escala ao invés de
  // criação de um segundo gráfico") — cada dia carrega tanto as métricas de
  // preço (valorM3Vendido/precoPonderado) quanto o m³ de cada TipoProduto
  // naquele dia, para o front plotar tudo num único gráfico combinado
  // (barras empilhadas no eixo de m³ + linhas no eixo de R$/m³).
  const tiposVolume = [...new Set(linhasParaGrafico.map((l) => l.tipoProduto))].sort()
  const m3PorDiaTipo = new Map(
    agregarVendas(linhasParaGrafico, (l) => `${l.data}|${l.tipoProduto}`).map((a) => [a.chave, a.m3Total]),
  )
  const porDia = porDiaBase.map((d) => {
    const linha: Record<string, unknown> = { ...d, hoje: d.chave === hojeStr }
    for (const tipo of tiposVolume) linha[tipo] = m3PorDiaTipo.get(`${d.chave}|${tipo}`) ?? 0
    return linha
  })

  // Resumo por categoria SEMPRE sobre linhasPeriodo (não filtrado) — o
  // filtro de categoria mostra quanto cada opção representa antes de
  // marcar/desmarcar, não só o que já está selecionado.
  const porCategoria = agregarVendas(linhasPeriodo, (l) => l.tipoProduto)
  // Filtro de Marca (AMARU x STANDARD) — mesmo princípio de categoriasDisponiveis/porCategoria: sempre sobre linhasPeriodo, não filtrado pela própria marca.
  const marcasDisponiveis = [...new Set(linhasPeriodo.map((l) => l.marca))].sort()
  const porMarca = agregarVendas(linhasPeriodo, (l) => l.marca)

  // Cards de ICMS e Mourão/Peças + insight — mesmos conceitos do painel
  // estratégico, replicados aqui (pedido do usuário 2026-08-05).
  function icmsNum(tabela: string): number {
    const m = tabela.match(/(\d+)/)
    return m ? Number(m[1]) : 999
  }
  const porTabelaPeriodo = [...agregarVendas(linhasSemFiltroTabela, (l) => l.tabelaPreco)].sort(
    (a, b) => icmsNum(a.chave) - icmsNum(b.chave),
  )
  const linhasAgronegocio = linhas.filter((l) => l.tipoProduto === 'Agronegócio')
  const totalAgronegocio = agregarVendas(linhasAgronegocio, () => 'total')[0] ?? null
  const porSubTipoProdutoPeriodo = agregarVendas(
    linhasSemFiltroSubtipo.filter((l) => l.tipoProduto === 'Agronegócio'),
    (l) => l.subTipoProduto,
  ).filter((s) => s.chave === 'Mourão' || s.chave === 'Peças')
  let insightMouraoPecas: {
    m3Mourao: number
    m3Pecas: number
    pctMourao: number
    pctPecas: number
    precoMouraoAtual: number
    precoPecasAtual: number
    metaBlend: number
    precoPecasMinimoNecessario: number
    precoMouraoMinimoNecessario: number
  } | null = null
  const mourao = porSubTipoProdutoPeriodo.find((s) => s.chave === 'Mourão')
  const pecas = porSubTipoProdutoPeriodo.find((s) => s.chave === 'Peças')
  if (
    mourao &&
    pecas &&
    totalAgronegocio?.precoPonderado != null &&
    mourao.m3Total > 0 &&
    pecas.m3Total > 0 &&
    mourao.valorM3Vendido != null &&
    pecas.valorM3Vendido != null
  ) {
    const m3TotalMix = mourao.m3Total + pecas.m3Total
    const metaBlend = totalAgronegocio.precoPonderado
    insightMouraoPecas = {
      m3Mourao: mourao.m3Total,
      m3Pecas: pecas.m3Total,
      pctMourao: mourao.m3Total / m3TotalMix,
      pctPecas: pecas.m3Total / m3TotalMix,
      precoMouraoAtual: mourao.valorM3Vendido,
      precoPecasAtual: pecas.valorM3Vendido,
      metaBlend,
      precoPecasMinimoNecessario: (metaBlend * m3TotalMix - mourao.m3Total * mourao.valorM3Vendido) / pecas.m3Total,
      precoMouraoMinimoNecessario: (metaBlend * m3TotalMix - pecas.m3Total * pecas.valorM3Vendido) / mourao.m3Total,
    }
  }

  return NextResponse.json({
    period: { from, to: toOficial, toSolicitado: to },
    hoje: hojeResumo,
    categoriasDisponiveis,
    porCategoria,
    clientesDisponiveis,
    totalGeral,
    porDia,
    tiposVolume,
    porTabelaPeriodo,
    porSubTipoProdutoPeriodo,
    insightMouraoPecas,
    marcasDisponiveis,
    porMarca,
    insightDiametroMourao,
    porDistribuidor,
    porDistribuidorCliente,
    distribuidoresSemVenda,
    porProduto,
    porCliente,
    porClienteProduto,
    porClienteProdutoNota,
    porDistribuidorClienteProduto,
    porProdutoEspecifico,
    produtosPorMes,
    dispersaoPreco,
    abaixoTabela4,
    abaixoTabela4Total: {
      transacoes: todasAbaixoTabela4.length,
      valorPerdido: todasAbaixoTabela4.reduce((s, l) => s + l.valorPerdido, 0),
    },
    comparativoCotas,
    linhasSemDados: linhas.length === 0,
  })
}
