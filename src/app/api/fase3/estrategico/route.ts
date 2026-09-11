import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, hasModuleAccess } from '@/lib/authz'
import { getDatasetView } from '@/lib/semantic/dataset-view'
import { prepararVendas, agregarVendas, DISTRIBUIDORES_CONHECIDOS } from '@/lib/fase3/faturamento'
import {
  carregarMetaPeriodo,
  compararComCotas,
  carregarNomesClientes,
  calcularInsightDiametroMourao,
  resolverConfigVendas,
  carregarSaldoFisicoProdutos,
} from '@/lib/fase3/cotas'
import { aplicarEscopoUsuario } from '@/lib/fase3/escopo-usuario'
import { hojeBrasil } from '@/lib/horario-brasil'

/** "ICMS 7%" -> 7, "ICMS 18%" -> 18 — para ordenar as tabelas por alíquota crescente em vez de alfabético (que colocaria "12%" antes de "7%"). */
function icmsNum(tabela: string): number {
  const m = tabela.match(/(\d+)/)
  return m ? Number(m[1]) : 999
}

/**
 * Fase 3 — Painel estratégico anual: pedido do usuário 2026-08-04 ("montar
 * um painel estratégico pegando os números do ano para ver onde estão as
 * perdas, visto que nos meses anteriores conseguimos bater as metas de
 * preço médio"). Separado de /api/fase3/data (que é o recorte tático por
 * período livre) porque aqui o recorte é sempre o ano inteiro e o foco é
 * "onde" (mês/distribuidor/produto) a perda de preço se concentrou.
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser()
  if (!hasModuleAccess(user, 'fase3')) return NextResponse.json({ error: 'acesso negado' }, { status: 403 })

  const anoParam = req.nextUrl.searchParams.get('ano')
  const ano = anoParam && /^\d{4}$/.test(anoParam) ? anoParam : String(new Date().getFullYear())
  const categoriasParam = req.nextUrl.searchParams.get('categorias')
  const categoriasSelecionadas = categoriasParam ? categoriasParam.split(',').filter(Boolean) : null
  const mesParam = req.nextUrl.searchParams.get('mes')
  // Cards clicáveis (pedido do usuário 2026-08-05: "todos os cards precisam
  // ser clicáveis com o ctrl para selecionar") — filtro por alíquota de ICMS
  // e por Mourão/Peças, no mesmo padrão de `categorias` (lista separada por
  // vírgula, aplicado a `linhas` antes de todas as agregações abaixo).
  const tabelasParam = req.nextUrl.searchParams.get('tabelas')
  const tabelasSelecionadas = tabelasParam ? tabelasParam.split(',').filter(Boolean) : null
  const subTiposParam = req.nextUrl.searchParams.get('subtipos')
  const subTiposSelecionados = subTiposParam ? subTiposParam.split(',').filter(Boolean) : null
  // Filtro superior de Marca AMARU x STANDARD (pedido do usuário 2026-08-13) —
  // mesmo padrão de /api/fase3/data.
  const marcasParam = req.nextUrl.searchParams.get('marcas')
  const marcasSelecionadas = marcasParam ? marcasParam.split(',').filter(Boolean) : null
  // Filtro por Distribuidor em checkbox — pedido do usuário 2026-08-24:
  // "colocar mais um filtro de distribuidor nos painéis de venda de
  // madeira" — mesmo padrão de /api/fase3/data.
  const distribuidoresParam = req.nextUrl.searchParams.get('distribuidores')
  const distribuidoresSelecionados = distribuidoresParam ? distribuidoresParam.split(',').filter(Boolean) : null
  // Filtro por cliente em combo de pesquisa (pedido do usuário 2026-08-05) —
  // mesmo padrão de /api/fase3/data.
  const clienteParam = req.nextUrl.searchParams.get('cliente')
  const clienteSelecionado = clienteParam ? clienteParam.trim() : null

  let view: Awaited<ReturnType<typeof getDatasetView>> = []
  try {
    view = await getDatasetView('fase3_vendas_madeira_tratada')
  } catch {
    view = [] // dataset ainda não sincronizado
  }

  // Anos disponíveis vêm do dataset inteiro (não só do ano selecionado), p/
  // popular o seletor de ano mesmo antes de trocar de ano.
  const anosDisponiveis = [
    ...new Set(
      view
        .map((r) => String((r as Record<string, unknown>).DATASAIDA ?? '').slice(0, 4))
        .filter((a) => /^\d{4}$/.test(a)),
    ),
  ].sort()

  const config = await resolverConfigVendas()
  const linhasAno = aplicarEscopoUsuario(prepararVendas(view, `${ano}-01-01`, `${ano}-12-31`, config), user!.escopoVendas)
  const categoriasDisponiveis = [...new Set(linhasAno.map((l) => l.tipoProduto))].sort()
  const porCategoria = agregarVendas(linhasAno, (l) => l.tipoProduto)
  // Filtro de Marca (AMARU x STANDARD) — mesmo princípio de categoriasDisponiveis/porCategoria: sempre sobre linhasAno, não filtrado pela própria marca.
  const marcasDisponiveis = [...new Set(linhasAno.map((l) => l.marca))].sort()
  const porMarca = agregarVendas(linhasAno, (l) => l.marca)
  // Distribuidores disponíveis SEMPRE sobre linhasAno (não filtrado) — mesmo
  // princípio de categoriasDisponiveis/marcasDisponiveis acima.
  const distribuidoresDisponiveis = [...new Set(linhasAno.map((l) => l.distribuidor))].sort()
  const porDistribuidorTodos = agregarVendas(linhasAno, (l) => l.distribuidor)

  // Um card clicável precisa sempre mostrar TODAS as suas próprias opções
  // (com a % real), mesmo quando uma delas já está selecionada — senão,
  // selecionar "ICMS 7%" faria os cards de 12%/18% desaparecerem, sem como
  // voltar. Por isso cada grupo de cards usa uma variante de `linhas` que
  // aplica os OUTROS filtros, mas não o dele próprio.
  const linhasCategoria = categoriasSelecionadas
    ? linhasAno.filter((l) => categoriasSelecionadas.includes(l.tipoProduto))
    : linhasAno
  const linhasMarca = marcasSelecionadas ? linhasCategoria.filter((l) => marcasSelecionadas.includes(l.marca)) : linhasCategoria
  const linhasDistribuidorFiltro = distribuidoresSelecionados
    ? linhasMarca.filter((l) => distribuidoresSelecionados.includes(l.distribuidor))
    : linhasMarca
  // Lista de clientes SEMPRE sobre linhasDistribuidorFiltro (respeita o
  // distribuidor selecionado, mas não o próprio cliente) — pedido do
  // usuário 2026-09-11: "quando seleciono o distribuidor só liste os
  // clientes daquele distribuidor". Antes desta mudança usava linhasAno
  // (universo inteiro), ignorando o filtro de distribuidor.
  const clientesDisponiveis = [...new Set(linhasDistribuidorFiltro.map((l) => l.cliente || '—'))].sort()
  const linhasClienteFiltro = clienteSelecionado
    ? linhasDistribuidorFiltro.filter((l) => (l.cliente || '—') === clienteSelecionado)
    : linhasDistribuidorFiltro
  const linhasSemFiltroTabela = subTiposSelecionados
    ? linhasClienteFiltro.filter((l) => subTiposSelecionados.includes(l.subTipoProduto))
    : linhasClienteFiltro
  const linhasSemFiltroSubtipo = tabelasSelecionadas
    ? linhasClienteFiltro.filter((l) => tabelasSelecionadas.includes(l.tabelaPreco))
    : linhasClienteFiltro
  const linhas = tabelasSelecionadas
    ? linhasSemFiltroTabela.filter((l) => tabelasSelecionadas.includes(l.tabelaPreco))
    : linhasSemFiltroTabela

  const porMes = agregarVendas(linhas, (l) => l.mes).sort((a, b) => a.chave.localeCompare(b.chave))
  const mesesComVenda = porMes.filter((m) => m.valorM3Vendido != null)
  const mesesComPerda = mesesComVenda.filter((m) => m.abaixoDoMinimo).length
  const mesesOk = mesesComVenda.length - mesesComPerda

  const porDistribuidor = [...agregarVendas(linhas, (l) => l.distribuidor)].sort(
    (a, b) => b.perdaEstimada - a.perdaEstimada,
  )
  const porDistribuidorCliente = agregarVendas(linhas, (l) => `${l.distribuidor}|${l.cliente || '—'}`).map((a) => {
    const [distribuidor, cliente] = a.chave.split('|')
    return { ...a, distribuidor, cliente }
  })
  // Produtos por cliente por distribuidor (pedido do usuário 2026-08-04:
  // "quando expandir por cliente colocar... os produtos com maior perda") —
  // segundo nível de expansão dentro de cada cliente.
  const porDistribuidorClienteProduto = agregarVendas(linhas, (l) => `${l.distribuidor}|${l.cliente || '—'}|${l.produto}`).map((a) => {
    const [distribuidor, cliente, produto] = a.chave.split('|')
    return { ...a, distribuidor, cliente, produto }
  })
  const distribuidoresComVenda = new Set(porDistribuidor.map((d) => d.chave))
  const distribuidoresSemVenda = DISTRIBUIDORES_CONHECIDOS.filter((d) => !distribuidoresComVenda.has(d))
  // Pedido do usuário 2026-08-04: "o top perdas precisa saber com qual
  // distribuidor perdeu" — a chave passou a incluir distribuidor (antes era
  // só produto×tabela, sem dar pra saber de quem era a venda).
  const porProdutoEspecifico = agregarVendas(linhas, (l) => `${l.distribuidor}|${l.produto}|${l.tabelaPreco}`)
    .map((a) => {
      const [distribuidor, produto, tabelaPreco] = a.chave.split('|')
      return { ...a, distribuidor, produto, tabelaPreco }
    })
    .sort((a, b) => icmsNum(a.tabelaPreco) - icmsNum(b.tabelaPreco) || b.perdaEstimada - a.perdaEstimada)

  // Perda por mês dentro de cada distribuidor×produto×tabela (pedido do
  // usuário: "mostrar por mês") — usado para expandir cada linha do "onde
  // estão as perdas por produto" com a linha do tempo mensal.
  const porProdutoMes = agregarVendas(linhas, (l) => `${l.distribuidor}|${l.produto}|${l.tabelaPreco}|${l.mes}`).map((a) => {
    const [distribuidor, produto, tabelaPreco, mes] = a.chave.split('|')
    return { ...a, distribuidor, produto, tabelaPreco, mes }
  })

  // Perda por CLIENTE dentro de cada distribuidor×produto×tabela (pedido do
  // usuário 2026-08-04: "na perda por produto específico, abrir por cliente
  // para ver quem está pior") — segundo drill-down da mesma linha, ao lado do
  // "por mês" que já existia.
  const porProdutoCliente = agregarVendas(linhas, (l) => `${l.distribuidor}|${l.produto}|${l.tabelaPreco}|${l.cliente || '—'}`)
    .map((a) => {
      const [distribuidor, produto, tabelaPreco, cliente] = a.chave.split('|')
      return { ...a, distribuidor, produto, tabelaPreco, cliente }
    })
    .sort((a, b) => b.perdaEstimada - a.perdaEstimada)

  // "Onde estão meus melhores ganhos" (pedido do usuário 2026-08-04) — mesma
  // métrica de margem (valorM3Vendido − precoPonderado), só que ordenada do
  // maior ganho para o menor, em vez de maior perda primeiro.
  const melhoresGanhosDistribuidor = [...agregarVendas(linhas, (l) => l.distribuidor)]
    .filter((d) => (d.margem ?? 0) > 0)
    .sort((a, b) => (b.margem ?? 0) - (a.margem ?? 0))
  const melhoresGanhosProduto = agregarVendas(linhas, (l) => `${l.distribuidor}|${l.produto}|${l.tabelaPreco}`)
    .map((a) => {
      const [distribuidor, produto, tabelaPreco] = a.chave.split('|')
      return { ...a, distribuidor, produto, tabelaPreco }
    })
    .filter((p) => (p.margem ?? 0) > 0)
    .sort((a, b) => icmsNum(a.tabelaPreco) - icmsNum(b.tabelaPreco) || (b.margem ?? 0) - (a.margem ?? 0))

  const totalGeral = agregarVendas(linhas, () => 'total')[0] ?? null
  const perdaEstimadaTotal = porMes.reduce((s, m) => s + m.perdaEstimada, 0)

  // Comparativo com as cotas de venda cadastradas (pedido do usuário
  // 2026-08-13) — meta soma os 12 meses do ano selecionado, realizado vem das
  // MESMAS `linhas` já filtradas (categoria/tabela/subtipo/cliente).
  // Ritmo do mês de referência (Achado do usuário 2026-08-13): usa hoje quando
  // o ano selecionado é o corrente; anos passados usam dezembro (mês já
  // fechado, ritmo vira só um retrato histórico do último mês do ano).
  const hojeStr = hojeBrasil()
  const toRitmo = ano === hojeStr.slice(0, 4) ? hojeStr : `${ano}-12-31`
  const [metaAno, nomesClientes, saldoFisicoPorProduto] = await Promise.all([
    carregarMetaPeriodo(`${ano}-01-01`, `${ano}-12-31`),
    carregarNomesClientes(),
    carregarSaldoFisicoProdutos(),
  ])
  // Usuário restrito (escopoVendas != null): a meta/cota é company-wide, não
  // segmentada por distribuidor/cliente — comparar o realizado (já filtrado
  // pelo escopo) contra ela vazaria nome/meta de outros distribuidores e
  // produziria ritmo/margem incorretos (meta global vs. realizado parcial).
  // Achado da revisão final de código (2026-09-11): para usuário restrito,
  // simplesmente não calcular o comparativo.
  const comparativoCotas =
    user!.escopoVendas == null
      ? compararComCotas(linhas, metaAno, toRitmo, nomesClientes, undefined, undefined, saldoFisicoPorProduto)
      : null
  // Proporção 8-10/10-12 (pedido do usuário 2026-08-13) — mesmo cálculo do tático.
  const insightDiametroMourao = calcularInsightDiametroMourao(linhas, metaAno.produtos)

  // Cards pedidos pelo usuário 2026-08-05: "% em volume vendido para cada
  // alíquota de ICMS, Faturamento Líquido Total, Preço médio e meta de
  // destino" — mesma métrica de `porMes`/`porDistribuidor`, só que agregada
  // no ano inteiro. Vem de `linhasSemFiltroTabela` (não `linhas`) para as 3
  // opções continuarem visíveis mesmo com uma alíquota já selecionada.
  const porTabelaAno = [...agregarVendas(linhasSemFiltroTabela, (l) => l.tabelaPreco)].sort(
    (a, b) => icmsNum(a.chave) - icmsNum(b.chave),
  )

  // Mourão x Peças (só existe dentro de Agronegócio) — pedido do usuário:
  // "card com a proporção em volume peças e mourão e qual o preço médio do
  // m³ cúbico de peças e mourão". `totalAgronegocio` (a "meta" do insight
  // abaixo) usa `linhas` (respeita o filtro de ICMS selecionado); os CARDS
  // de Mourão/Peças usam `linhasSemFiltroSubtipo` para as duas opções
  // continuarem visíveis mesmo com uma delas já selecionada.
  const linhasAgronegocio = linhas.filter((l) => l.tipoProduto === 'Agronegócio')
  const totalAgronegocio = agregarVendas(linhasAgronegocio, () => 'total')[0] ?? null
  const porSubTipoProdutoAno = agregarVendas(
    linhasSemFiltroSubtipo.filter((l) => l.tipoProduto === 'Agronegócio'),
    (l) => l.subTipoProduto,
  ).filter(
    (s) => s.chave === 'Mourão' || s.chave === 'Peças',
  )

  // Insight (pedido do usuário): "na proporção de venda entre peças e
  // mourão, qual deveria ser o valor mínimo para ficar no positivo" — dado o
  // mix real de m³ vendido entre os dois e o preço médio que CADA UM está
  // realizando hoje, qual seria o preço mínimo que o OUTRO precisaria
  // atingir para o blend (Mourão+Peças) chegar exatamente na meta de destino
  // (precoPonderado do Agronegócio, que é o mínimo ponderado por ICMS —
  // não varia por Mourão/Peças, só a proporção de mix muda o preço médio
  // real). Resolve a equação do blend mantendo o m³ de cada um fixo:
  // metaBlend × m3Total = m3Mourão×precoMourão + m3Peças×precoPeças.
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
  const mourao = porSubTipoProdutoAno.find((s) => s.chave === 'Mourão')
  const pecas = porSubTipoProdutoAno.find((s) => s.chave === 'Peças')
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

  // Evolução mensal Mourão x Peças (pedido do usuário 2026-08-05: "vamos
  // montar um gráfico de evolução no ano do % peças mourão volume e preços
  // por m3") — % de volume de cada um por mês, e o R$/m³ de cada um por mês.
  // Sempre sobre `linhasAgronegocio` (ICMS já filtrado se selecionado, mas
  // SEM o filtro de subtipo — senão um dos dois sumiria do gráfico).
  const linhasAgronegocioSemFiltroSubtipo = linhasSemFiltroSubtipo.filter((l) => l.tipoProduto === 'Agronegócio')
  const porMesSubTipo = agregarVendas(linhasAgronegocioSemFiltroSubtipo, (l) => `${l.mes}|${l.subTipoProduto}`)
    .map((a) => {
      const [mes, subTipoProduto] = a.chave.split('|')
      return { ...a, mes, subTipoProduto }
    })
    .filter((a) => a.subTipoProduto === 'Mourão' || a.subTipoProduto === 'Peças')
  const mesesComMix = [...new Set(porMesSubTipo.map((a) => a.mes))].sort()
  const evolucaoMouraoPecas = mesesComMix.map((mes) => {
    const mourao = porMesSubTipo.find((a) => a.mes === mes && a.subTipoProduto === 'Mourão')
    const pecas = porMesSubTipo.find((a) => a.mes === mes && a.subTipoProduto === 'Peças')
    const m3Mourao = mourao?.m3Total ?? 0
    const m3Pecas = pecas?.m3Total ?? 0
    const m3TotalMes = m3Mourao + m3Pecas
    return {
      mes,
      pctMourao: m3TotalMes > 0 ? (m3Mourao / m3TotalMes) * 100 : null,
      pctPecas: m3TotalMes > 0 ? (m3Pecas / m3TotalMes) * 100 : null,
      precoMourao: mourao?.valorM3Vendido ?? null,
      precoPecas: pecas?.valorM3Vendido ?? null,
    }
  })

  // Detalhe de um mês específico (pedido do usuário 2026-08-04: "ter a
  // opção de clicar no mês e trazer os detalhes do mês específico") —
  // opcional, só calculado quando o front pede via ?mes=YYYY-MM.
  let mesDetalhe = null
  if (mesParam && /^\d{4}-\d{2}$/.test(mesParam)) {
    const linhasMes = linhas.filter((l) => l.mes === mesParam)
    mesDetalhe = {
      mes: mesParam,
      totalGeral: agregarVendas(linhasMes, () => 'total')[0] ?? null,
      // Pedido do usuário 2026-08-04: "precisa separar por alíquota de ICMS
      // pois eles têm valores mínimos e ponderados distintos, o total do mês
      // também pondera" — o total do mês já é uma média ponderada entre as
      // 3 alíquotas (m3_minimo distinto por estado), então essa quebra
      // mostra o mínimo/realizado de CADA alíquota isoladamente.
      porTabela: [...agregarVendas(linhasMes, (l) => l.tabelaPreco)].sort((a, b) => icmsNum(a.chave) - icmsNum(b.chave)),
      porDistribuidor: [...agregarVendas(linhasMes, (l) => l.distribuidor)].sort((a, b) => b.perdaEstimada - a.perdaEstimada),
      porProdutoEspecifico: agregarVendas(linhasMes, (l) => `${l.distribuidor}|${l.produto}|${l.tabelaPreco}`)
        .map((a) => {
          const [distribuidor, produto, tabelaPreco] = a.chave.split('|')
          return { ...a, distribuidor, produto, tabelaPreco }
        })
        .sort((a, b) => b.perdaEstimada - a.perdaEstimada),
    }
  }

  return NextResponse.json({
    ano,
    anosDisponiveis,
    categoriasDisponiveis,
    porCategoria,
    clientesDisponiveis,
    totalGeral,
    porTabelaAno,
    porSubTipoProdutoAno,
    insightMouraoPecas,
    marcasDisponiveis,
    porMarca,
    distribuidoresDisponiveis,
    porDistribuidorTodos,
    insightDiametroMourao,
    evolucaoMouraoPecas,
    perdaEstimadaTotal,
    mesesComVenda: mesesComVenda.length,
    mesesComPerda,
    mesesOk,
    porMes,
    porDistribuidor,
    porDistribuidorCliente,
    porDistribuidorClienteProduto,
    distribuidoresSemVenda,
    porProdutoEspecifico,
    porProdutoMes,
    porProdutoCliente,
    melhoresGanhosDistribuidor,
    melhoresGanhosProduto,
    mesDetalhe,
    comparativoCotas,
    linhasSemDados: linhas.length === 0,
  })
}
