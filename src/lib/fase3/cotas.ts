/**
 * Fase 3 — Cotas de venda: comparação meta x realizado, usada tanto na
 * Análise por período (tático) quanto no Painel Estratégico. Pedido do
 * usuário 2026-08-13: "preciso que seja inserido na analise por periodo e na
 * analise estrategico os comparativos com as cotas e com os parametros de
 * distribuição por aliquota de ICMS".
 *
 * `DistributorQuota`/`ProductQuota` são cadastradas por MÊS (não por período
 * livre) — quando o período/ano selecionado cobre vários meses, a meta do
 * recorte é a SOMA das metas de cada mês cadastrado dentro dele (cada mês já
 * é um valor mensal completo, então somar meses dá a meta justa do recorte).
 * A % alvo de ICMS não soma entre meses (é proporção, não valor absoluto) —
 * usamos a média ponderada pela meta de volume de cada mês.
 */
import { prisma } from '@/lib/prisma'
import { getDatasetView } from '@/lib/semantic/dataset-view'
import { hojeBrasil } from '@/lib/horario-brasil'
import { VendaLinha, agregarVendas } from './faturamento'

/**
 * CODCFO (cadastro de clientes, dataset `fase3_clientes`) → nome do cliente.
 * Pedido do usuário 2026-08-13: "para informações de cota foi utilizado o
 * codigo que representar um cliente no cadastro de clientes favor fazer
 * associação e trazer o nome" — `DistributorQuota.codDistribuidor` é o mesmo
 * código que `FCFOCOMPL.DISTRIBUIDOR` grava na venda (ver `faturamento.ts`),
 * que por sua vez é um `CODCFO` de verdade (confirmado com dados reais: os
 * 3 códigos cadastrados batem exatamente com `fase3_clientes.CODCFO`) — cada
 * distribuidor é o PRÓPRIO cliente destinatário na venda direta. Um código
 * sem match (ex. "C99999999", usado como placeholder na importação da
 * planilha) cai no fallback do `nomeDistribuidor` cadastrado manualmente.
 */
export async function carregarNomesClientes(): Promise<Map<string, string>> {
  let view: Awaited<ReturnType<typeof getDatasetView>> = []
  try {
    view = await getDatasetView('fase3_clientes')
  } catch {
    return new Map()
  }
  const map = new Map<string, string>()
  for (const r of view as Record<string, unknown>[]) {
    const codigo = String(r.CODCFO ?? '').trim()
    const nome = String(r.CLIENTE ?? '').trim()
    if (codigo && nome) map.set(codigo, nome)
  }
  return map
}

/**
 * Uma data por mês tocado por `from`..`to`, construída do MESMO jeito que
 * `firstDay()` nas rotas admin de cotas (`new Date(\`\${month}-01T00:00:00\`)`,
 * sem sufixo `Z`) — sem isso, a comparação `month: { in: meses } }` no Prisma
 * não bate com as linhas já cadastradas (a diferença de fuso horário move o
 * timestamp UTC alguumas horas para frente).
 */
function monthsBetween(from: string, to: string): Date[] {
  const out: Date[] = []
  const [fy, fm] = from.slice(0, 7).split('-').map(Number)
  const [ty, tm] = to.slice(0, 7).split('-').map(Number)
  let y = fy
  let m = fm
  while (y * 12 + m <= ty * 12 + tm) {
    out.push(new Date(`${y}-${String(m).padStart(2, '0')}-01T00:00:00`))
    m++
    if (m > 12) {
      m = 1
      y++
    }
  }
  return out
}

export interface MetaPeriodo {
  metaVolumeM3: number
  icms7Pct: number | null
  icms12Pct: number | null
  icms18Pct: number | null
  distribuidores: { codDistribuidor: string; nomeDistribuidor: string | null; metaValor: number }[]
  produtos: { codigoPrd: string; nomeProduto: string | null; m3PorUnidade: number | null; cotaUnidades: number }[]
  mesesComCadastro: number
  totalMeses: number
  /** meta de volume de CADA mês individualmente (não somada) — usada para o ritmo/evolução do mês de referência */
  metaVolumePorMes: { mes: string; metaVolumeM3: number }[]
  /** meta de cada distribuidor em CADA mês individualmente (não somada) — mesma finalidade, para o ritmo por distribuidor */
  distribuidoresPorMes: { mes: string; codDistribuidor: string; metaValor: number }[]
}

/**
 * Ritmo/evolução genérico — pedido do usuário 2026-08-13 (volume) e depois
 * "fazer a mesma conta do ritmo" para a meta de distribuidor: dado quanto já
 * foi vendido nos dias em que HOUVE venda, projeta se o mês vai fechar dentro
 * da meta, e quanto falta vender por DIA ÚTIL restante do mês para alcançá-la.
 */
export interface RitmoInfo {
  diasDoMes: number | null
  /** dias distintos do mês de referência com pelo menos uma venda (do que está sendo medido: geral, ou de um distribuidor específico) */
  diasComFaturamento: number
  /** meta(do mês) / diasDoMes × diasComFaturamento — quanto já deveríamos ter alcançado no ritmo ideal */
  ritmoEsperado: number | null
  /** true = realizado ≥ ritmo esperado */
  dentroDoRitmo: boolean | null
  /** realizado ÷ diasComFaturamento × diasDoMes — projeção de fechamento no ritmo atual */
  projecaoFechamento: number | null
  /** dias úteis (seg-sex) restantes do mês de referência a partir de hoje — 0 se o mês de referência já não é o mês corrente */
  diasUteisRestantes: number
  /** (meta − realizado) ÷ diasUteisRestantes — quanto precisa vender por dia útil até o fim do mês para bater a meta; 0 se já alcançada; null sem meta ou sem dias úteis restantes */
  necessarioPorDiaUtil: number | null
}

/** Dias úteis (seg-sex, sem considerar feriados) do dia seguinte a hoje até o fim de `mesReferencia` — 0 se esse mês já não é o mês corrente (mês fechado ou futuro). */
function diasUteisRestantesNoMes(mesReferencia: string): number {
  const hoje = hojeBrasil()
  if (mesReferencia !== hoje.slice(0, 7)) return 0
  const [ano, mes] = mesReferencia.split('-').map(Number)
  const ultimoDia = new Date(ano, mes, 0).getDate()
  const hojeDia = Number(hoje.slice(8, 10))
  let count = 0
  for (let d = hojeDia + 1; d <= ultimoDia; d++) {
    const diaSemana = new Date(ano, mes - 1, d).getDay()
    if (diaSemana !== 0 && diaSemana !== 6) count++
  }
  return count
}

function calcularRitmo(meta: number | null, realizado: number, diasDoMes: number | null, diasComFaturamento: number, mesReferencia: string): RitmoInfo {
  const ritmoEsperado = meta != null && diasDoMes ? (meta / diasDoMes) * diasComFaturamento : null
  const dentroDoRitmo = ritmoEsperado != null ? realizado >= ritmoEsperado : null
  const projecaoFechamento = diasComFaturamento > 0 && diasDoMes ? (realizado / diasComFaturamento) * diasDoMes : null
  const diasUteisRestantes = diasUteisRestantesNoMes(mesReferencia)
  const faltante = meta != null ? meta - realizado : null
  const necessarioPorDiaUtil =
    faltante == null ? null : faltante <= 0 ? 0 : diasUteisRestantes > 0 ? faltante / diasUteisRestantes : null
  return { diasDoMes, diasComFaturamento, ritmoEsperado, dentroDoRitmo, projecaoFechamento, diasUteisRestantes, necessarioPorDiaUtil }
}

/** Carrega e consolida (soma/média ponderada) as cotas cadastradas para todo mês tocado pelo período `from`..`to`. */
export async function carregarMetaPeriodo(from: string, to: string): Promise<MetaPeriodo> {
  const meses = monthsBetween(from, to)
  const [settings, distQuotas, prodQuotas] = await Promise.all([
    prisma.monthlyQuotaSettings.findMany({ where: { month: { in: meses } } }),
    prisma.distributorQuota.findMany({ where: { month: { in: meses } } }),
    prisma.productQuota.findMany({ where: { month: { in: meses } } }),
  ])

  const metaVolumeM3 = settings.reduce((s, r) => s + Number(r.metaVolumeM3), 0)
  let wIcms7 = 0
  let wIcms12 = 0
  let wIcms18 = 0
  for (const r of settings) {
    const w = Number(r.metaVolumeM3)
    wIcms7 += Number(r.icms7Pct) * w
    wIcms12 += Number(r.icms12Pct) * w
    wIcms18 += Number(r.icms18Pct) * w
  }

  const distMap = new Map<string, { codDistribuidor: string; nomeDistribuidor: string | null; metaValor: number }>()
  for (const r of distQuotas) {
    const e = distMap.get(r.codDistribuidor) ?? { codDistribuidor: r.codDistribuidor, nomeDistribuidor: r.nomeDistribuidor, metaValor: 0 }
    e.metaValor += Number(r.metaValor)
    if (!e.nomeDistribuidor && r.nomeDistribuidor) e.nomeDistribuidor = r.nomeDistribuidor
    distMap.set(r.codDistribuidor, e)
  }

  const prodMap = new Map<string, { codigoPrd: string; nomeProduto: string | null; m3PorUnidade: number | null; cotaUnidades: number }>()
  for (const r of prodQuotas) {
    const e = prodMap.get(r.codigoPrd) ?? {
      codigoPrd: r.codigoPrd,
      nomeProduto: r.nomeProduto,
      m3PorUnidade: r.m3PorUnidade != null ? Number(r.m3PorUnidade) : null,
      cotaUnidades: 0,
    }
    e.cotaUnidades += Number(r.cotaUnidades)
    if (e.m3PorUnidade == null && r.m3PorUnidade != null) e.m3PorUnidade = Number(r.m3PorUnidade)
    prodMap.set(r.codigoPrd, e)
  }

  return {
    metaVolumeM3,
    icms7Pct: metaVolumeM3 > 0 ? wIcms7 / metaVolumeM3 : null,
    icms12Pct: metaVolumeM3 > 0 ? wIcms12 / metaVolumeM3 : null,
    icms18Pct: metaVolumeM3 > 0 ? wIcms18 / metaVolumeM3 : null,
    distribuidores: [...distMap.values()],
    produtos: [...prodMap.values()],
    mesesComCadastro: settings.length,
    totalMeses: meses.length,
    metaVolumePorMes: settings
      .map((r) => ({ mes: r.month.toISOString().slice(0, 7), metaVolumeM3: Number(r.metaVolumeM3) }))
      .sort((a, b) => a.mes.localeCompare(b.mes)),
    distribuidoresPorMes: distQuotas.map((r) => ({
      mes: r.month.toISOString().slice(0, 7),
      codDistribuidor: r.codDistribuidor,
      metaValor: Number(r.metaValor),
    })),
  }
}

export interface ComparativoVolume {
  metaVolumeM3: number
  realizadoM3: number
  pctAtingido: number | null
  /**
   * Ritmo/evolução — pedido do usuário 2026-08-13: "fazer um calculo de
   * evolução com base na quantidade de dias com faturamento dentro do mês
   * exemplo 5000/dias do mês * dias com faturamento para ver se esta dentro
   * da meta e se vai alcançar a meta". Calculado sobre o MÊS de `toOficial`
   * (não o período somado, que pode cruzar vários meses) — usa só a meta e
   * o realizado daquele mês específico.
   */
  mesReferencia: string | null
  diasDoMes: number | null
  /** dias distintos do mês de referência (até `toOficial`) com pelo menos uma venda */
  diasComFaturamento: number | null
  /** metaVolumeM3(do mês) / diasDoMes × diasComFaturamento — quanto já deveríamos ter vendido no ritmo ideal */
  ritmoEsperadoM3: number | null
  /** true = realizado do mês ≥ ritmo esperado (dentro ou acima do ritmo) */
  dentroDoRitmo: boolean | null
  /** realizado do mês ÷ diasComFaturamento × diasDoMes — projeção de fechamento no ritmo atual */
  projecaoFechamentoM3: number | null
  /** dias úteis restantes do mês corrente (0 se o mês de referência já não é o corrente) */
  diasUteisRestantes: number
  /** m³ que faltam vender por dia útil restante para bater a meta do mês; 0 se já alcançada, null sem dias úteis restantes */
  necessarioPorDiaUtilM3: number | null
}
export interface ComparativoIcms {
  tabelaPreco: string
  metaPct: number | null
  realM3: number
  realPct: number | null
  /** preço mínimo ponderado desta faixa de ICMS no período real (m3_minimo médio, pelo mix de produto efetivamente vendido dentro da faixa) — usado no impacto do mix */
  minimoFaixa: number | null
  /** R$/m³ realmente praticado nesta faixa no período (valorM3Vendido) — pedido do usuário 2026-08-13: "colocar qual o preço praticado no card e quanto abaixo ou acima do mínimo estamos" */
  precoPraticado: number | null
  /** precoPraticado − minimoFaixa (positivo = acima do mínimo, negativo = abaixo) */
  diferencaMinimo: number | null
}
/**
 * Impacto do mix de ICMS no preço mínimo ponderado geral — pedido do usuário
 * 2026-08-13: "se fugir da meta precisamos recalcular se é benefico ou
 * malefico para a meta de preço mínimo ponderado. O calculo dos % das
 * aliquiotas foi desenvolvido pois vendendo dentro daquela distribuição
 * alcançaria o preço mínimo do m3". Cada faixa de ICMS tem seu próprio
 * mínimo (estado do cliente × produto); a meta de distribuição cadastrada
 * (ex.: 60,04/4,46/35,50 em ago/2026 — não necessariamente 60/20/20, ajustável
 * por mês) foi calibrada pra que, NAQUELE mix, a média ponderada dos mínimos batesse o preço-alvo.
 * Comparamos essa média "se o mix fosse o da meta" com a média do mix REAL:
 * se o mix real desviou para faixas de mínimo mais baixo, a barra a vencer
 * fica mais fácil (benefício); se desviou pra faixas de mínimo mais alto,
 * fica mais difícil (malefício) — independente de estar vendendo bem ou mal
 * dentro de cada faixa.
 */
export interface ImpactoMixIcms {
  /** média dos mínimos de cada faixa, ponderada pela % META (o que a meta de distribuição cadastrada pressupõe) */
  precoPonderadoMetaMix: number | null
  /** média dos mínimos de cada faixa, ponderada pelo mix REAL vendido no período */
  precoPonderadoRealMix: number | null
  /** realMix − metaMix: negativo = mix real baixou a barra (benefício), positivo = subiu (malefício) */
  diferenca: number | null
  impacto: 'beneficio' | 'malefico' | 'neutro' | null
}
export interface ComparativoDistribuidorCota {
  codDistribuidor: string
  nomeDistribuidor: string | null
  metaValor: number
  realizado: number
  pctAtingido: number | null
  /** ritmo/projeção do mês de referência para ESTE distribuidor — pedido do usuário 2026-08-13: "para a meta do distribuidor precisamos fazer a mesma conta do ritmo" */
  ritmo: RitmoInfo
}
export interface ComparativoProdutoCota {
  codigoPrd: string
  nomeProduto: string | null
  cotaUnidades: number
  vendidoUnidades: number
  m3PorUnidade: number | null
  metaM3: number | null
  vendidoM3: number
  pctAtingido: number | null
}
export interface ComparativoCotas {
  temCadastro: boolean
  volume: ComparativoVolume
  icms: ComparativoIcms[]
  impactoMixIcms: ImpactoMixIcms
  distribuidores: ComparativoDistribuidorCota[]
  produtos: ComparativoProdutoCota[]
}

/**
 * Monta o comparativo completo meta x realizado para as linhas de venda já
 * filtradas ao período/ano desejado. `linhas` deve conter a MESMA janela de
 * tempo usada para calcular `meta` (via `carregarMetaPeriodo`). `to` é o fim
 * do recorte (ex. `toOficial`) — usado só para achar o mês de referência do
 * ritmo de volume. `nomesClientes` (opcional, `carregarNomesClientes()`)
 * resolve o nome de exibição do distribuidor pelo cadastro de clientes.
 */
export function compararComCotas(
  linhas: VendaLinha[],
  meta: MetaPeriodo,
  to: string,
  nomesClientes?: Map<string, string>,
): ComparativoCotas {
  const total = agregarVendas(linhas, () => 'total')[0] ?? null
  const realizadoM3 = total?.m3Total ?? 0

  const mesReferencia = to.slice(0, 7)
  const metaMesRef = meta.metaVolumePorMes.find((m) => m.mes === mesReferencia)?.metaVolumeM3 ?? null
  const [anoRef, mesRefNum] = mesReferencia.split('-').map(Number)
  const diasDoMes = anoRef && mesRefNum ? new Date(anoRef, mesRefNum, 0).getDate() : null
  const linhasDoMes = linhas.filter((l) => l.mes === mesReferencia)
  const realizadoM3Mes = agregarVendas(linhasDoMes, () => 'total')[0]?.m3Total ?? 0
  const diasComFaturamentoVolume = new Set(
    linhasDoMes.filter((l) => l.tipoMovimento === 'Vendas' && l.contaM3 && l.m3Total > 0).map((l) => l.data),
  ).size
  const ritmoVolume = calcularRitmo(metaMesRef, realizadoM3Mes, diasDoMes, diasComFaturamentoVolume, mesReferencia)

  const volume: ComparativoVolume = {
    metaVolumeM3: meta.metaVolumeM3,
    realizadoM3,
    pctAtingido: meta.metaVolumeM3 > 0 ? realizadoM3 / meta.metaVolumeM3 : null,
    mesReferencia,
    diasDoMes,
    diasComFaturamento: diasComFaturamentoVolume,
    ritmoEsperadoM3: ritmoVolume.ritmoEsperado,
    dentroDoRitmo: ritmoVolume.dentroDoRitmo,
    projecaoFechamentoM3: ritmoVolume.projecaoFechamento,
    diasUteisRestantes: ritmoVolume.diasUteisRestantes,
    necessarioPorDiaUtilM3: ritmoVolume.necessarioPorDiaUtil,
  }

  const porTabela = agregarVendas(linhas, (l) => l.tabelaPreco)
  const m3TotalTabelas = porTabela.reduce((s, t) => s + t.m3Total, 0)
  const metasIcms: [string, number | null][] = [
    ['ICMS 7%', meta.icms7Pct],
    ['ICMS 12%', meta.icms12Pct],
    ['ICMS 18%', meta.icms18Pct],
  ]
  const icms: ComparativoIcms[] = metasIcms.map(([tabelaPreco, metaPct]) => {
    const t = porTabela.find((p) => p.chave === tabelaPreco)
    const realM3 = t?.m3Total ?? 0
    const minimoFaixa = t?.precoPonderado ?? null
    const precoPraticado = t?.valorM3Vendido ?? null
    return {
      tabelaPreco,
      metaPct,
      realM3,
      realPct: m3TotalTabelas > 0 ? (realM3 / m3TotalTabelas) * 100 : null,
      minimoFaixa,
      precoPraticado,
      diferencaMinimo: precoPraticado != null && minimoFaixa != null ? precoPraticado - minimoFaixa : null,
    }
  })

  // Impacto do mix: só dá pra comparar quando toda faixa tem meta % E mínimo
  // conhecido (senão a média ponderada fica incompleta e engana).
  const impactoMixIcms: ImpactoMixIcms = (() => {
    const completo = icms.every((i) => i.metaPct != null && i.minimoFaixa != null)
    if (!completo) return { precoPonderadoMetaMix: null, precoPonderadoRealMix: null, diferenca: null, impacto: null }
    const precoPonderadoMetaMix = icms.reduce((s, i) => s + (i.metaPct! / 100) * i.minimoFaixa!, 0)
    const precoPonderadoRealMix =
      m3TotalTabelas > 0 ? icms.reduce((s, i) => s + (i.realM3 / m3TotalTabelas) * i.minimoFaixa!, 0) : null
    const diferenca = precoPonderadoRealMix != null ? precoPonderadoRealMix - precoPonderadoMetaMix : null
    const impacto: ImpactoMixIcms['impacto'] =
      diferenca == null ? null : diferenca < -0.01 ? 'beneficio' : diferenca > 0.01 ? 'malefico' : 'neutro'
    return { precoPonderadoMetaMix, precoPonderadoRealMix, diferenca, impacto }
  })()

  const realizadoPorDistribuidor = new Map(agregarVendas(linhas, (l) => l.codDistribuidor || '—').map((a) => [a.chave, a.faturamentoLiquido]))
  // Ritmo por distribuidor (pedido do usuário 2026-08-13: "para a meta do
  // distribuidor precisamos fazer a mesma conta do ritmo") — meta e
  // realizado restritos ao MÊS de referência (não o período somado), igual
  // ao volume; dias com faturamento contam só os dias em que ESSE
  // distribuidor teve venda, não a frota inteira.
  const metaDistribuidorMes = new Map<string, number>()
  for (const r of meta.distribuidoresPorMes) {
    if (r.mes !== mesReferencia) continue
    metaDistribuidorMes.set(r.codDistribuidor, (metaDistribuidorMes.get(r.codDistribuidor) ?? 0) + r.metaValor)
  }
  const realizadoPorDistribuidorMes = new Map(agregarVendas(linhasDoMes, (l) => l.codDistribuidor || '—').map((a) => [a.chave, a]))
  const distribuidores: ComparativoDistribuidorCota[] = meta.distribuidores
    .map((q) => {
      const realizado = realizadoPorDistribuidor.get(q.codDistribuidor) ?? 0
      const nomeDistribuidor = nomesClientes?.get(q.codDistribuidor) ?? q.nomeDistribuidor
      const realizadoMes = realizadoPorDistribuidorMes.get(q.codDistribuidor)?.faturamentoLiquido ?? 0
      const diasComFaturamentoDist = new Set(
        linhasDoMes.filter((l) => l.tipoMovimento === 'Vendas' && (l.codDistribuidor || '—') === q.codDistribuidor).map((l) => l.data),
      ).size
      const metaDistMes = metaDistribuidorMes.get(q.codDistribuidor) ?? null
      const ritmo = calcularRitmo(metaDistMes, realizadoMes, diasDoMes, diasComFaturamentoDist, mesReferencia)
      return { ...q, nomeDistribuidor, realizado, pctAtingido: q.metaValor > 0 ? realizado / q.metaValor : null, ritmo }
    })
    .sort((a, b) => (a.pctAtingido ?? 0) - (b.pctAtingido ?? 0))

  const agregadoPorProduto = new Map(agregarVendas(linhas, (l) => l.codigoPrd || '—').map((a) => [a.chave, a]))
  const produtos: ComparativoProdutoCota[] = meta.produtos
    .map((q) => {
      const a = agregadoPorProduto.get(q.codigoPrd)
      const vendidoUnidades = a?.vendasUN ?? 0
      const vendidoM3 = a?.m3Total ?? 0
      const metaM3 = q.m3PorUnidade != null ? q.cotaUnidades * q.m3PorUnidade : null
      return { ...q, vendidoUnidades, vendidoM3, metaM3, pctAtingido: q.cotaUnidades > 0 ? vendidoUnidades / q.cotaUnidades : null }
    })
    .sort((a, b) => (a.pctAtingido ?? 0) - (b.pctAtingido ?? 0))

  return { temCadastro: meta.mesesComCadastro > 0, volume, icms, impactoMixIcms, distribuidores, produtos }
}

export interface InsightDiametroMourao {
  classe1: string
  classe2: string
  /** unidades vendidas (Σ quantidade) — pedido do usuário 2026-08-21: o % é por unidade, não por m³ */
  unidadesClasse1: number
  unidadesClasse2: number
  /** m³ vendido — só para exibição, não entra na conta do % */
  m3Classe1: number
  m3Classe2: number
  /** unidadesClasse1 ÷ (unidadesClasse1 + unidadesClasse2) */
  pctClasse1: number
  pctClasse2: number
  metaUnidadesClasse1: number | null
  metaUnidadesClasse2: number | null
  metaM3Classe1: number | null
  metaM3Classe2: number | null
  /** meta por unidade (cotaUnidades), mesma base do pctClasse1/pctClasse2 real, para a comparação ser justa */
  metaPctClasse1: number | null
  metaPctClasse2: number | null
  /** |pctClasse1 - metaPctClasse1| <= 5 p.p. — `null` quando não há meta cadastrada para comparar */
  dentroDaMeta: boolean | null
}

/**
 * Proporção de venda entre os produtos Mourão (2,20m) de diâmetro "08-10" e
 * "10-12" — pedido do usuário 2026-08-13, a partir do gauge "PROPORÇÃO 8-10
 * 10-12" visto no Power BI de referência. Compara com a meta cadastrada em
 * `ProductQuota` para os mesmos dois produtos (quando existir), verificando
 * se a distribuição vendida está de acordo com a distribuição planejada —
 * não só o volume total de cada um.
 */
export function calcularInsightDiametroMourao(
  linhas: VendaLinha[],
  metaProdutos: MetaPeriodo['produtos'],
): InsightDiametroMourao | null {
  const CLASSE_1 = '08-10'
  const CLASSE_2 = '10-12'
  const PREFIXO_1 = '2,20 X 08 - 10'
  const PREFIXO_2 = '2,20 X 10 - 12'

  let unidadesClasse1 = 0
  let unidadesClasse2 = 0
  let m3Classe1 = 0
  let m3Classe2 = 0
  for (const l of linhas) {
    // Pedido do usuário 2026-08-21: "em todas as análises de venda... deve-se
    // desconsiderar os movimentos de bonificação" (exceto Volume Vendido/
    // Expedido, que não se aplicam aqui) — esta proporção somava m³ de
    // bonificação e devolução junto com venda, distorcendo o mix real vendido.
    if (l.tipoMovimento !== 'Vendas') continue
    if (l.subTipoProduto !== 'Mourão') continue
    if (l.classeDiametro === CLASSE_1) {
      unidadesClasse1 += l.quantidade
      m3Classe1 += l.m3Total
    } else if (l.classeDiametro === CLASSE_2) {
      unidadesClasse2 += l.quantidade
      m3Classe2 += l.m3Total
    }
  }
  // Pedido do usuário 2026-08-21: "preciso saber por unidade, o % será por
  // unidade, o m3 só exibir" — o % (real e meta) passa a ser por unidade
  // vendida (quantidade), não por m³; o m³ continua calculado só para
  // exibição ao lado do %, sem influenciar a proporção.
  const totalUnidades = unidadesClasse1 + unidadesClasse2
  if (totalUnidades <= 0) return null

  function metaM3(prefixo: string): number | null {
    const registros = metaProdutos.filter((p) => (p.nomeProduto ?? '').startsWith(prefixo) && p.m3PorUnidade != null)
    if (registros.length === 0) return null
    return registros.reduce((soma, p) => soma + p.cotaUnidades * (p.m3PorUnidade ?? 0), 0)
  }
  function metaUnidades(prefixo: string): number | null {
    const registros = metaProdutos.filter((p) => (p.nomeProduto ?? '').startsWith(prefixo))
    if (registros.length === 0) return null
    return registros.reduce((soma, p) => soma + p.cotaUnidades, 0)
  }
  const metaUnidadesClasse1 = metaUnidades(PREFIXO_1)
  const metaUnidadesClasse2 = metaUnidades(PREFIXO_2)
  const metaM3Classe1 = metaM3(PREFIXO_1)
  const metaM3Classe2 = metaM3(PREFIXO_2)
  const metaTotalUnidades = (metaUnidadesClasse1 ?? 0) + (metaUnidadesClasse2 ?? 0)
  const temMeta = metaUnidadesClasse1 != null && metaUnidadesClasse2 != null && metaTotalUnidades > 0
  const metaPctClasse1 = temMeta ? metaUnidadesClasse1! / metaTotalUnidades : null
  const metaPctClasse2 = temMeta ? metaUnidadesClasse2! / metaTotalUnidades : null

  const pctClasse1 = unidadesClasse1 / totalUnidades
  const pctClasse2 = unidadesClasse2 / totalUnidades

  return {
    classe1: CLASSE_1,
    classe2: CLASSE_2,
    unidadesClasse1,
    unidadesClasse2,
    m3Classe1,
    m3Classe2,
    pctClasse1,
    pctClasse2,
    metaUnidadesClasse1,
    metaUnidadesClasse2,
    metaM3Classe1,
    metaM3Classe2,
    metaPctClasse1,
    metaPctClasse2,
    dentroDaMeta: metaPctClasse1 != null ? Math.abs(pctClasse1 - metaPctClasse1) <= 0.05 : null,
  }
}
