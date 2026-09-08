import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, hasModuleAccess } from '@/lib/authz'
import { getDatasetView } from '@/lib/semantic/dataset-view'
import { prepararVendas, agregarVendas, registrosAlteradosAposFechamento } from '@/lib/fase3/faturamento'
import { carregarMetaPeriodo, resolverConfigVendas } from '@/lib/fase3/cotas'
import { buildCompositionResolver } from '@/lib/fase1/composition'

function monthStart(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}
function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Fase 3 — Crítica ao modelo: pedido do usuário 2026-08-04 ("critique o
 * modelo sobre os cálculos em uma aba específica trazendo exemplos para
 * análises e avaliarmos possíveis erros conceituais no modelo"). Recalcula,
 * com dados reais do período selecionado, os achados desta sessão de
 * investigação (Planep, assimetria Meta Destino/Preço Ponderado, m³
 * residual, Serragem) para que sejam auditáveis a qualquer momento, não só
 * uma nota estática no changelog.
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser()
  if (!hasModuleAccess(user, 'fase3')) return NextResponse.json({ error: 'acesso negado' }, { status: 403 })

  const from = req.nextUrl.searchParams.get('from') || monthStart()
  const to = req.nextUrl.searchParams.get('to') || todayStr()

  const config = await resolverConfigVendas()
  let linhas: ReturnType<typeof prepararVendas> = []
  try {
    const view = await getDatasetView('fase3_vendas_madeira_tratada')
    linhas = prepararVendas(view, from, to, config)
  } catch {
    linhas = []
  }

  // Achado 1: bonificação "indevida" da Planep (regra de negócio diz que não
  // deveria existir) — reclassificada como venda no faturamento, mas ainda
  // rastreável via bonificacaoOriginal.
  const bonifPlanep = linhas.filter((l) => l.bonificacaoOriginal && l.distribuidor === 'PLANEP')
  const bonifPlanepPorCliente = new Map<string, { cliente: string; n: number; valor: number }>()
  for (const l of bonifPlanep) {
    const e = bonifPlanepPorCliente.get(l.cliente) ?? { cliente: l.cliente || '—', n: 0, valor: 0 }
    e.n++
    e.valor += l.valorBruto
    bonifPlanepPorCliente.set(l.cliente, e)
  }
  const achado1 = {
    transacoes: bonifPlanep.length,
    valorNominal: bonifPlanep.reduce((s, l) => s + l.valorBruto, 0),
    top3Clientes: [...bonifPlanepPorCliente.values()].sort((a, b) => b.valor - a.valor).slice(0, 3),
  }

  // Achado 2: assimetria Meta Destino (soma preco_ponderado excluindo só
  // Bonificações, mas Total m3 vendido já desconta Devolução) x Preço
  // Ponderado (exclui Devolução E Bonificação nos dois lados) — medido ao
  // vivo para o período selecionado.
  const vendasEDevolucoes = linhas.filter((l) => l.tipoMovimento !== 'Bonificacoes')
  const somaPesoMinimoComDevolucao = vendasEDevolucoes.reduce((s, l) => (l.contaM3 ? s + l.m3PesoMinimo : s), 0)
  const totalM3Vendido = agregarVendas(linhas, () => 'total')[0]?.m3Total ?? 0
  const metaDestinoAssimetrico = totalM3Vendido > 0 ? somaPesoMinimoComDevolucao / totalM3Vendido : null
  const precoPonderadoSimetrico = agregarVendas(linhas, () => 'total')[0]?.precoPonderado ?? null

  // Achado 3: bonificação nominal x diferença de tabela 4 (a mudança pedida
  // e depois pausada em 2026-08-04) lado a lado.
  const bonificacoes = linhas.filter((l) => l.bonificacaoOriginal)
  const bonifNominal = bonificacoes.reduce((s, l) => s + l.valorBruto, 0)
  const bonifDiferencaTabela4 = bonificacoes.reduce(
    (s, l) => s + (l.precoMedioTabela4 - l.valorBruto / (l.quantidade || 1)) * l.quantidade,
    0,
  )

  // Achado 4: produtos com M3_UNITARIO suspeito (zero) que distorcem m³/preço por m³.
  const m3PorProduto = new Map<string, { produto: string; linhas: number; m3Total: number; faturamento: number }>()
  for (const l of linhas) {
    if (l.tipoMovimento !== 'Vendas') continue
    const e = m3PorProduto.get(l.produto) ?? { produto: l.produto, linhas: 0, m3Total: 0, faturamento: 0 }
    e.linhas++
    e.m3Total += l.m3Total
    e.faturamento += l.valorBruto
    m3PorProduto.set(l.produto, e)
  }
  const produtosM3Zero = [...m3PorProduto.values()]
    .filter((p) => p.m3Total === 0 && p.faturamento > 0)
    .sort((a, b) => b.faturamento - a.faturamento)
    .slice(0, 10)

  // Achado 5: registros do período editados/criados no Oracle DEPOIS do fim
  // do período — candidatos a explicar divergência com um relatório externo
  // (BI) que tenha sido gerado antes dessas correções tardias.
  const registrosAlterados = registrosAlteradosAposFechamento(linhas, to)

  // Achado 7: distribuidor por período (ao vivo) — prova de que TOP TOP
  // aparece corretamente agora (antes do fix, tudo isto caía em "SEM
  // DISTRIBUIDOR").
  const porDistribuidorAchado7 = agregarVendas(linhas, (l) => l.distribuidor)
    .sort((a, b) => b.faturamentoLiquido - a.faturamentoLiquido)

  // Achado 10: linhas com o flag BRUTO de bonificação (TMOVCOMPL.BONIFICACAO
  // ='SIM') mas classificadas como "Vendas" pelo CODTMV — desconto embutido
  // numa venda normal, sem passar pelo movimento formal de bonificação. Ao
  // vivo para o período selecionado, já que esse padrão pode se repetir em
  // qualquer mês (não é exclusivo de julho).
  const flagSemCodtmvBonif = linhas.filter((l) => l.flagBonificacao && l.tipoMovimento !== 'Bonificacoes')
  const achado10 = {
    transacoes: flagSemCodtmvBonif.length,
    valorComPrecoVendido: flagSemCodtmvBonif.reduce((s, l) => s + l.valorBruto, 0),
    valorComPrecoBase: flagSemCodtmvBonif.reduce((s, l) => s + l.valorBase, 0),
    diferenca: flagSemCodtmvBonif.reduce((s, l) => s + (l.valorBruto - l.valorBase), 0),
    exemplos: flagSemCodtmvBonif.slice(0, 10).map((l) => ({
      data: l.data,
      distribuidor: l.distribuidor,
      cliente: l.cliente,
      produto: l.produto,
      quantidade: l.quantidade,
      precoVendido: l.quantidade > 0 ? l.valorBruto / l.quantidade : 0,
      precoMedioTabela4: l.precoMedioTabela4,
    })),
  }

  // Achado 11: cotas cadastradas (Cadastros → Cotas de venda) não batem com
  // a meta de volume do mês — pedido do usuário 2026-08-13: "critica nos
  // paineis que as cotas não coincidem com a meta de volume a ser vendido".
  // Verificado para o mês corrente (ou `?mes=YYYY-MM`), não para o período
  // `from`/`to` acima, já que cotas são um cadastro mensal, não um recorte
  // livre como o resto desta aba.
  const mesParam = req.nextUrl.searchParams.get('mes')
  const mesAchado11 = mesParam && /^\d{4}-\d{2}$/.test(mesParam) ? mesParam : monthStart().slice(0, 7)
  const metaMes = await carregarMetaPeriodo(`${mesAchado11}-01`, `${mesAchado11}-01`)
  const somaM3Produtos = metaMes.produtos.reduce((s, p) => s + (p.m3PorUnidade != null ? p.cotaUnidades * p.m3PorUnidade : 0), 0)
  const produtosSemFatorM3 = metaMes.produtos.filter((p) => p.m3PorUnidade == null).length
  const somaIcmsPct = (metaMes.icms7Pct ?? 0) + (metaMes.icms12Pct ?? 0) + (metaMes.icms18Pct ?? 0)
  const achado11 = {
    mes: mesAchado11,
    temCadastro: metaMes.mesesComCadastro > 0,
    metaVolumeM3: metaMes.metaVolumeM3,
    somaM3ProdutosCadastrados: somaM3Produtos,
    produtosSemFatorM3,
    produtosCadastrados: metaMes.produtos.length,
    diferencaVolumePct: metaMes.metaVolumeM3 > 0 ? (somaM3Produtos / metaMes.metaVolumeM3 - 1) * 100 : null,
    somaIcmsPct: metaMes.mesesComCadastro > 0 ? somaIcmsPct : null,
  }

  // Achado 12: nota de VENDA de madeira tratada aparecendo para uma placa
  // que, na data da nota, já estava com composição Tritrem Florestal
  // (transporte interno de madeira, fora do escopo comercial da Fase 3) —
  // mesmo problema já monitorado no Fase 1 ("nota_apos_tritrem", achado do
  // usuário 2026-08-19), agora verificado também contra a fonte de vendas
  // desta fase. Pedido do usuário 2026-09-08: "vamos colocar isto na
  // crítica" (não existe fonte própria de nota de transporte interno de
  // madeira ainda — só monitora quando essa placa aparece indevidamente
  // aqui, na venda comercial).
  const resolveComposition = await buildCompositionResolver()
  const linhasTritrem = linhas.filter((l) => l.placa && resolveComposition(l.placa, l.data) === 'Tritrem Florestal')
  const porPlacaTritrem = new Map<string, { placa: string; n: number; primeira: string; ultima: string; valor: number }>()
  for (const l of linhasTritrem) {
    const e = porPlacaTritrem.get(l.placa) ?? { placa: l.placa, n: 0, primeira: l.data, ultima: l.data, valor: 0 }
    e.n++
    e.valor += l.valorBruto
    if (l.data < e.primeira) e.primeira = l.data
    if (l.data > e.ultima) e.ultima = l.data
    porPlacaTritrem.set(l.placa, e)
  }
  const achado12 = {
    transacoes: linhasTritrem.length,
    valorTotal: linhasTritrem.reduce((s, l) => s + l.valorBruto, 0),
    porPlaca: [...porPlacaTritrem.values()].sort((a, b) => b.valor - a.valor),
  }

  return NextResponse.json({
    period: { from, to },
    achado1PlanepBonificacaoIndevida: achado1,
    achado2AssimetriaMetaDestino: {
      metaDestinoAssimetrico,
      precoPonderadoSimetrico,
      diferenca: metaDestinoAssimetrico != null && precoPonderadoSimetrico != null ? metaDestinoAssimetrico - precoPonderadoSimetrico : null,
    },
    achado3BonificacaoNominalVsTabela4: {
      bonifNominal,
      bonifDiferencaTabela4,
      diferenca: bonifDiferencaTabela4 - bonifNominal,
    },
    achado4ProdutosSemM3: produtosM3Zero,
    achado7PorDistribuidor: porDistribuidorAchado7,
    achado10FlagBonificacaoSemCodtmv: achado10,
    achado5RegistrosAlteradosAposFechamento: {
      total: registrosAlterados.length,
      valorTotal: registrosAlterados.reduce((s, r) => s + r.valorBruto, 0),
      registros: registrosAlterados.slice(0, 200),
    },
    achado11CotasVsMetaVolume: achado11,
    achado12NotaVendaAposTritrem: achado12,
  })
}
