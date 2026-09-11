import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, hasModuleAccess } from '@/lib/authz'
import { getDatasetView, getUltimaAtualizacao } from '@/lib/semantic/dataset-view'
import {
  prepararVendas,
  agregarVendas,
  produtosAoLongoDoTempo,
  dispersaoPrecoPorProdutoTabela,
  vendasAbaixoTabela4,
  calcularBonificacaoDoMes,
  ofensoresDePerda,
  DISTRIBUIDORES_CONHECIDOS,
} from '@/lib/fase3/faturamento'
import {
  carregarMetaPeriodo,
  compararComCotas,
  carregarNomesClientes,
  calcularInsightDiametroMourao,
  resolverConfigVendas,
  carregarFatoresBonificacao,
  resolverFatorBonificacao,
  carregarValoresMensais,
  resolverValorMensal,
  PREFIXO_CUSTO_PRODUCAO_MES,
  PREFIXO_DESPESAS_IMPOSTOS_PCT_MES,
  carregarSaldoFisicoProdutos,
} from '@/lib/fase3/cotas'
import { aplicarEscopoUsuario } from '@/lib/fase3/escopo-usuario'
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
  // Filtro por Distribuidor em checkbox — pedido do usuário 2026-08-24:
  // "colocar mais um filtro de distribuidor nos painéis de venda de
  // madeira". Universo pequeno e conhecido (PLANEP/TOP TOP/EXTRA/...),
  // mesmo padrão de checkbox de Categoria/Marca (não é combo de busca como
  // Cliente, que tem milhares de opções).
  const distribuidoresParam = req.nextUrl.searchParams.get('distribuidores')
  const distribuidoresSelecionados = distribuidoresParam ? distribuidoresParam.split(',').filter(Boolean) : null
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

  // Conjuntos de CODTMV/produtos configuráveis via Cadastros → Parâmetros
  // (pedido do usuário 2026-08-21: "motor de fórmulas editável") — buscado
  // aqui, ANTES de `prepararVendas`, porque tanto o período quanto o
  // acompanhamento de "hoje" abaixo precisam do mesmo `config`.
  const config = await resolverConfigVendas()

  const linhasPeriodoTodosMovimentos = aplicarEscopoUsuario(prepararVendas(view, from, toOficial, config), user!.escopoVendas)
  const linhasPeriodo = tipoMovimentoSelecionado
    ? linhasPeriodoTodosMovimentos.filter((l) => tipoMovimentoSelecionado.includes(l.tipoMovimento))
    : linhasPeriodoTodosMovimentos

  // "Hoje" — acompanhamento à parte (pedido do usuário 2026-08-13): mesmo
  // com hoje fora do comparativo oficial (antes das 18h), o dia continua
  // visível aqui para quem quer saber "o que já vendemos hoje" sem esperar
  // o corte liberar.
  const hojeStr = hojeBrasil()
  const linhasHojeTodosMovimentos = to >= hojeStr ? aplicarEscopoUsuario(prepararVendas(view, hojeStr, hojeStr, config), user!.escopoVendas) : []
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
          // Pedido do usuário 2026-08-21: análises de venda desconsideram
          // bonificação (exceto volume vendido/expedido) — NF de bonificação
          // não deve contar como "nota fiscal" de venda no resumo do dia.
          numeroNotas: new Set(
            linhasHoje.filter((l) => l.tipoMovimento === 'Vendas').map((l) => l.numeroMov).filter(Boolean),
          ).size,
        }
      : null

  // Categorias disponíveis calculadas ANTES do filtro de categoria (mostra
  // todas as opções do período, mesmo as não selecionadas no momento) —
  // pedido do usuário 2026-08-04: "trazer todas as categorias com um filtro
  // superior por categoria, deixando o agronegócio como padrão marcado".
  const categoriasDisponiveis = [...new Set(linhasPeriodo.map((l) => l.tipoProduto))].sort()
  // Distribuidores disponíveis SEMPRE sobre linhasPeriodo (não filtrado pelo
  // próprio distribuidor) — mesmo princípio de categoriasDisponiveis/
  // marcasDisponiveis acima.
  const distribuidoresDisponiveis = [...new Set(linhasPeriodo.map((l) => l.distribuidor))].sort()
  const porDistribuidorTodos = agregarVendas(linhasPeriodo, (l) => l.distribuidor)
  const linhasCategoria = categoriasSelecionadas
    ? linhasPeriodo.filter((l) => categoriasSelecionadas.includes(l.tipoProduto))
    : linhasPeriodo
  const linhasMarca = marcasSelecionadas ? linhasCategoria.filter((l) => marcasSelecionadas.includes(l.marca)) : linhasCategoria
  const linhasDistribuidorFiltro = distribuidoresSelecionados
    ? linhasMarca.filter((l) => distribuidoresSelecionados.includes(l.distribuidor))
    : linhasMarca
  // Lista de clientes SEMPRE sobre linhasDistribuidorFiltro (respeita o
  // distribuidor selecionado, mas não o próprio cliente) — pedido do
  // usuário 2026-09-11: "quando seleciono o distribuidor só liste os
  // clientes daquele distribuidor". Antes desta mudança usava linhasPeriodo
  // (universo inteiro), ignorando o filtro de distribuidor.
  const clientesDisponiveis = [...new Set(linhasDistribuidorFiltro.map((l) => l.cliente || '—'))].sort()
  const linhasClienteFiltro = clienteSelecionado
    ? linhasDistribuidorFiltro.filter((l) => (l.cliente || '—') === clienteSelecionado)
    : linhasDistribuidorFiltro
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
  // Por Nota Fiscal (pedido do usuário 2026-08-21: "preciso da opção de
  // visualização que eu consiga ver por nota fiscal e na nota fiscal ter
  // todas as métricas do painel para que eu possa avaliar venda a venda,
  // preciso validar os cálculos") — cada NF passa pelo MESMO `agregarVendas`
  // usado em todo o resto do painel (mesmas fórmulas, mesmo motor), agrupada
  // por NUMEROMOV; `itens` traz as linhas cruas (produto a produto) que
  // compõem a nota, para conferir manualmente contra a fonte (quantidade ×
  // preço, desconto, m³) o que o agregado está somando.
  const linhasPorNota = new Map<string, typeof linhas>()
  for (const l of linhas) {
    const key = l.numeroMov || '—'
    const arr = linhasPorNota.get(key) ?? []
    arr.push(l)
    linhasPorNota.set(key, arr)
  }
  const porNota = agregarVendas(linhas, (l) => l.numeroMov || '—')
    .map((a) => {
      const itensNota = linhasPorNota.get(a.chave) ?? []
      const primeira = itensNota[0]
      return {
        ...a,
        numeroMov: a.chave,
        data: primeira?.data ?? '',
        distribuidor: primeira?.distribuidor ?? '',
        cliente: primeira?.cliente ?? '',
        tipoMovimento: primeira?.tipoMovimento ?? 'Vendas',
        itens: itensNota.map((l) => ({
          produto: l.produto,
          tabelaPreco: l.tabelaPreco,
          tipoMovimento: l.tipoMovimento,
          quantidade: l.quantidade,
          precoVendido: l.quantidade > 0 ? l.valorBruto / l.quantidade : 0,
          precoBase: l.precoBase,
          desconto: l.desconto,
          valorBruto: l.valorBruto,
          valorBase: l.valorBase,
          m3Total: l.m3Total,
          m3Minimo: l.m3Minimo,
          flagBonificacao: l.flagBonificacao,
        })),
      }
    })
    .sort((a, b) => b.data.localeCompare(a.data) || a.numeroMov.localeCompare(b.numeroMov))
  const produtosPorMes = produtosAoLongoDoTempo(linhas)
  // Principais ofensores de perda de receita (pedido do usuário 2026-09-10:
  // "mostrar os principais opressores de perda de receita... o que ao longo
  // do tempo gera resultado para ir trabalhando") — mesmo ranking nas 3
  // dimensões pedidas; mês de referência é o mês de `toOficial` (mesmo usado
  // no ritmo do comparativo de cotas). Cliente tem universo grande (milhares)
  // — só os 50 que mais perdem entram na resposta.
  const mesReferenciaOfensores = toOficial.slice(0, 7)
  const ofensoresProduto = ofensoresDePerda(linhas, (l) => l.produto, mesReferenciaOfensores)
  const ofensoresDistribuidor = ofensoresDePerda(linhas, (l) => l.distribuidor, mesReferenciaOfensores)
  const ofensoresCliente = ofensoresDePerda(linhas, (l) => l.cliente || '—', mesReferenciaOfensores).slice(0, 50)
  // Dispersão de preço por produto × ICMS (pedido do usuário 2026-08-04:
  // "mostrar produtos que têm um valor considerável de preço entre as
  // vendas de acordo com cada alíquota de ICMS") — top 30 maiores variações.
  const dispersaoPreco = dispersaoPrecoPorProdutoTabela(linhas).slice(0, 30)
  // Pedido original da nota Fase 3, nunca implementado até 2026-08-04:
  // "demonstrar quando preco_base ou preco_venda for menor do que
  // PRECO_MEDIO_TABELA4" — top 50 transações com maior valor perdido.
  const todasAbaixoTabela4 = vendasAbaixoTabela4(linhas)
  const abaixoTabela4 = todasAbaixoTabela4.slice(0, 50)
  const totalGeralAgregado = agregarVendas(linhas, () => 'total')[0] ?? null
  // Formula 7 do usuário (2026-08-20, corrigida 2026-08-31): "Bonificação do
  // mês = (faturamento bruto − faturamento base) × fator (bonificado =
  // SIM)" — fator cadastrado por ano/mês em Cadastros → Parâmetros
  // (FATOR_BONIFICACAO_MES_2026 / FATOR_BONIFICACAO_MES_202601), ver
  // `resolverFatorBonificacao` em src/lib/fase3/cotas.ts.
  const fatoresBonificacao = await carregarFatoresBonificacao()
  const totalGeral = totalGeralAgregado
    ? {
        ...totalGeralAgregado,
        bonificacaoDoMes: calcularBonificacaoDoMes(linhas, (mes) => resolverFatorBonificacao(mes, fatoresBonificacao)),
      }
    : null

  // Comparativo com as cotas de venda cadastradas (pedido do usuário
  // 2026-08-13) — meta soma todo mês cadastrado dentro do período `from`..`to`,
  // realizado vem das MESMAS `linhas` já filtradas (categoria/tabela/subtipo/cliente).
  const [metaPeriodo, nomesClientes, custosProducaoCadastrados, despesasImpostosCadastrados, saldoFisicoPorProduto] = await Promise.all([
    carregarMetaPeriodo(from, toOficial),
    carregarNomesClientes(),
    carregarValoresMensais(PREFIXO_CUSTO_PRODUCAO_MES),
    carregarValoresMensais(PREFIXO_DESPESAS_IMPOSTOS_PCT_MES),
    carregarSaldoFisicoProdutos(),
  ])
  const comparativoCotas = compararComCotas(
    linhas,
    metaPeriodo,
    toOficial,
    nomesClientes,
    (mes) => resolverValorMensal(mes, custosProducaoCadastrados),
    (mes) => resolverValorMensal(mes, despesasImpostosCadastrados),
    saldoFisicoPorProduto,
  )
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

  // Mesma ideia de `porDia`, mas agrupado por MÊS — pedido do usuário
  // 2026-08-21: "este gráfico quando colocar vários meses agrupar por mês"
  // (um período de vários meses vira uma parede ilegível de centenas de
  // barras diárias). O front decide qual dos dois usar no gráfico conforme
  // o período cobrir 1 ou vários meses; clicar num mês aqui estreita o
  // filtro de data para aquele mês, o que troca automaticamente o gráfico
  // de volta para `porDia` (drill natural, sem UI extra).
  const porMesBase = [...agregarVendas(linhasParaGrafico, (l) => l.mes)].sort((a, b) => a.chave.localeCompare(b.chave))
  const m3PorMesTipo = new Map(
    agregarVendas(linhasParaGrafico, (l) => `${l.mes}|${l.tipoProduto}`).map((a) => [a.chave, a.m3Total]),
  )
  const porMes = porMesBase.map((d) => {
    const linha: Record<string, unknown> = { ...d }
    for (const tipo of tiposVolume) linha[tipo] = m3PorMesTipo.get(`${d.chave}|${tipo}`) ?? 0
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

  const ultimaAtualizacao = await getUltimaAtualizacao(['fase3_vendas_madeira_tratada'])

  return NextResponse.json({
    period: { from, to: toOficial, toSolicitado: to },
    ultimaAtualizacao,
    hoje: hojeResumo,
    categoriasDisponiveis,
    porCategoria,
    clientesDisponiveis,
    totalGeral,
    porDia,
    porMes,
    tiposVolume,
    porTabelaPeriodo,
    porSubTipoProdutoPeriodo,
    insightMouraoPecas,
    marcasDisponiveis,
    porMarca,
    distribuidoresDisponiveis,
    porDistribuidorTodos,
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
    porNota,
    produtosPorMes,
    ofensoresProduto,
    ofensoresDistribuidor,
    ofensoresCliente,
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
