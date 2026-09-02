import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, hasModuleAccess } from '@/lib/authz'
import { prisma } from '@/lib/prisma'
import { getDatasetView, getUltimaAtualizacao } from '@/lib/semantic/dataset-view'
import { aggregateTrips, enrichTrips } from '@/lib/fase1/trips'
import { buildRouteMatcher } from '@/lib/fase1/route-match'
import { buildCompositionResolver, applyCompositionOverrides, composicoesAtuaisComDesde } from '@/lib/fase1/composition'
import { buildComplianceMap, applyWeightCompliance } from '@/lib/fase1/compliance'
import { buildFreightPriceResolver, quantidadeNaUnidade } from '@/lib/fase1/freight-price'
import { resolveParameter, calendarVarsFor } from '@/lib/semantic/parameters'

function paramNumber(
  all: { code: string; valueNumber: number | null; formula: string | null }[],
  code: string,
  fallback: number,
  calendar: ReturnType<typeof calendarVarsFor>,
): number {
  try {
    return resolveParameter(code, all, calendar)
  } catch {
    return fallback
  }
}

/** Dias de sobreposição entre [recStart, recEnd] e [periodFrom, periodTo] (todas datas YYYY-MM-DD) */
function overlapDays(recStart: string, recEnd: string, periodFrom: string, periodTo: string): number {
  const start = recStart > periodFrom ? recStart : periodFrom
  const end = recEnd < periodTo ? recEnd : periodTo
  if (start > end) return 0
  const startMs = new Date(`${start}T00:00:00`).getTime()
  const endMs = new Date(`${end}T00:00:00`).getTime()
  return Math.floor((endMs - startMs) / 86_400_000) + 1
}

/**
 * Meses (YYYYMM) tocados por [from, to], com quantos dias do período caem em
 * cada um e quantos dias tem o mês inteiro — para proratear o custo mensal
 * corretamente mesmo quando o período cruza a virada do mês.
 */
function monthsInRange(from: string, to: string): { ym: string; daysInPeriod: number; daysInMonth: number }[] {
  const result: { ym: string; daysInPeriod: number; daysInMonth: number }[] = []
  const end = new Date(`${to}T00:00:00`)
  let cursor = new Date(`${from}T00:00:00`)
  while (cursor <= end) {
    const y = cursor.getFullYear()
    const m = cursor.getMonth()
    const monthStart = new Date(y, m, 1)
    const monthEnd = new Date(y, m + 1, 0)
    const daysInMonth = monthEnd.getDate()
    const periodStartInMonth = cursor > monthStart ? cursor : monthStart
    const periodEndInMonth = end < monthEnd ? end : monthEnd
    const daysInPeriod =
      Math.floor((periodEndInMonth.getTime() - periodStartInMonth.getTime()) / 86_400_000) + 1
    result.push({ ym: `${y}${String(m + 1).padStart(2, '0')}`, daysInPeriod, daysInMonth })
    cursor = new Date(y, m + 1, 1)
  }
  return result
}

/** Código do parâmetro de meta por composição, ex.: "LS 3 Eixos" -> "META_KM_LS_3_EIXOS" */
function metaParamCode(composition: string): string {
  const slug = composition
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return `META_KM_${slug}`
}

/** Código do parâmetro de fator de conversão TON->MDC por produto, ex.: "Carvão" -> "FATOR_MDC_CARVAO" */
function fatorMdcParamCode(produto: string): string {
  const slug = produto
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return `FATOR_MDC_${slug}`
}

/**
 * Dados do painel Fase 1 — Transporte Rodoviário.
 * Query: from/to (YYYY-MM-DD, default mês atual). Devolve as viagens
 * (RodoTrem agregado) enriquecidas com KM rodado e expectativa de retorno,
 * mais os parâmetros de meta/ritmo. Filtros de dimensão são aplicados no
 * cliente (padrão de cross-filtragem).
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'não autorizado' }, { status: 401 })
  if (!hasModuleAccess(user, 'fase1')) {
    return NextResponse.json({ error: 'acesso negado' }, { status: 403 })
  }

  const today = new Date()
  const monthStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`
  const todayStr = today.toISOString().slice(0, 10)

  const from = req.nextUrl.searchParams.get('from') || monthStart
  const to = req.nextUrl.searchParams.get('to') || todayStr

  const view = await getDatasetView('fase1_vendas_transporte')

  const paramRows = await prisma.parameter.findMany()
  const all = paramRows.map((p) => ({
    code: p.code,
    valueNumber: p.valueNumber ? Number(p.valueNumber) : null,
    formula: p.formula,
  }))

  // Ritmo: proporcional ao dia de hoje quando o período alcança o mês
  // corrente; para períodos já encerrados, a meta cheia do mês.
  const periodEnd = new Date(`${to}T00:00:00`)
  const calendar =
    todayStr <= to ? calendarVarsFor(today) : calendarVarsFor(periodEnd)
  if (todayStr > to) calendar.diaDoMes = calendar.diasDoMes

  const metaKm = paramNumber(all, 'META_KM_MES', 8000, calendar)
  const ritmoKm = paramNumber(all, 'RITMO_KM', metaKm, calendar)

  const defaults = {
    speedLoadedKmh: paramNumber(all, 'VEL_CHEIO_PADRAO', 60, calendar),
    speedEmptyKmh: paramNumber(all, 'VEL_VAZIO_PADRAO', 75, calendar),
    loadMinutes: paramNumber(all, 'TEMPO_CARGA_PADRAO', 90, calendar),
    unloadMinutes: paramNumber(all, 'TEMPO_DESCARGA_PADRAO', 90, calendar),
  }

  const matcher = await buildRouteMatcher()

  // Composição vigente por placa na DATA de cada viagem (cadastro de
  // Composições, com histórico de mudanças). Sem cadastro para a placa,
  // mantém a coluna condicional migrada do PowerQuery.
  const resolveComposition = await buildCompositionResolver()
  const viewWithComposition = view.map((row) => {
    const c = resolveComposition(row.PLACA, String(row.DATASAIDA ?? '').slice(0, 10))
    return c ? { ...row, ['TipoComposição']: c } : row
  })

  // Composição vigente HOJE por placa — pedido do usuário 2026-08-19: placas
  // transferidas para Tritrem Florestal (transporte de madeira, fora do
  // escopo deste painel por enquanto) devem parar de contar como frota
  // ativa do Transporte Rodoviário (sem mais "sem viagem no período"/atraso
  // acumulando), mas continuam valendo normalmente nas estatísticas até o
  // dia da mudança. Sem essa data de corte não dá pra saber, só pelas
  // viagens (que somem do dataset assim que a placa vira Tritrem), se a
  // placa "sumiu" porque parou de rodar ou porque mudou de composição.
  const composicoesAtuais = await composicoesAtuaisComDesde(resolveComposition)

  // Entrada/saída de placa na estrutura — pedido do usuário 2026-08-28:
  // ponderar "KM médio por placa" (gráfico "Performance vs meses
  // anteriores") pelos dias que a placa esteve de fato na frota no mês, em
  // vez de contar qualquer placa com viagem no mês como uma placa inteira.
  // Entrada = createdAt do primeiro registro de PlateComposition da placa
  // (funciona também para meses passados, já que createdAt sempre existiu).
  // Saída = data do DELETE de PlateComposition mais recente para a placa,
  // lido da auditoria — só rastreável a partir de 2026-08-28 (quando o
  // handler de DELETE passou a gravar a placa em `details`; exclusões
  // anteriores a isso não têm placa recuperável, ver `03 - Changelog`).
  const primeiraComposicaoPorPlaca = await prisma.plateComposition.groupBy({
    by: ['placa'],
    _min: { createdAt: true },
  })
  const entradaPlaca: Record<string, string> = {}
  for (const c of primeiraComposicaoPorPlaca) {
    if (c._min.createdAt) entradaPlaca[c.placa] = c._min.createdAt.toISOString().slice(0, 10)
  }
  const exclusoesComposicao = await prisma.auditLog.findMany({
    where: { entity: 'PlateComposition', action: 'DELETE' },
    select: { createdAt: true, details: true },
  })
  const saidaPlaca: Record<string, string> = {}
  for (const e of exclusoesComposicao) {
    const placa = (e.details as { placa?: string } | null)?.placa
    if (!placa) continue
    const data = e.createdAt.toISOString().slice(0, 10)
    if (!saidaPlaca[placa] || data > saidaPlaca[placa]) saidaPlaca[placa] = data
  }

  // Devolve TODAS as viagens enriquecidas (desde a carga inicial): o cliente
  // aplica o período e os filtros de dimensão — assim o comparativo mensal
  // também responde à cross-filtragem do painel.
  // Composição final da viagem: cadastro de placa (acima) < rota com
  // composição fixa < 2+ notas agrupadas (RodoTrem) — vence a evidência mais
  // forte (ver applyCompositionOverrides).
  const tripsWithComposition = applyCompositionOverrides(aggregateTrips(viewWithComposition), matcher)
  const enrichedTrips = enrichTrips(tripsWithComposition, matcher, defaults)
  const complianceMap = await buildComplianceMap()
  const tripsWithCompliance = applyWeightCompliance(enrichedTrips, complianceMap)

  // Valor de referência de frete por rota (R$ por KM/TONELADA/MDC/M3,
  // conforme cadastrado), vigente na data de saída de cada viagem —
  // histórico por data, igual à composição por placa. A receita de frete
  // NUNCA vem do VALOR da nota fiscal: ele mistura frete e produto, então só
  // o valor contratado por rota mede o frete de verdade (pedido do usuário
  // 2026-07-29).
  const resolveFreightPrice = await buildFreightPriceResolver()
  const allTrips = tripsWithCompliance.map((trip) => {
    const route = matcher(trip)
    const rate = resolveFreightPrice(route?.id, String(trip.DATASAIDA ?? '').slice(0, 10))
    const receitaEsperada = rate ? rate.valor * quantidadeNaUnidade(trip, rate.unidade) : null
    return {
      ...trip,
      PRECO_REFERENCIA_VALOR: rate?.valor ?? null,
      PRECO_REFERENCIA_UNIDADE: rate?.unidade ?? null,
      RECEITA_ESPERADA: receitaEsperada,
    }
  })

  // Dias decorridos do período (para % de ocupação)
  const fromDate = new Date(`${from}T00:00:00`)
  const cutoff = todayStr <= to ? today : periodEnd
  const diasDecorridos = Math.max(
    1,
    Math.floor((cutoff.getTime() - fromDate.getTime()) / 86_400_000) + 1,
  )

  // Comparativo mensal corta todos os meses no dia de ONTEM (D-1): o dia
  // atual nunca tem o número fechado de cargas.
  const ontem = new Date(today.getTime() - 86_400_000)
  const cutoffDay = ontem.getDate()
  const mesAtual = ontem.toISOString().slice(0, 7)
  const diasDoMesAtual = new Date(ontem.getFullYear(), ontem.getMonth() + 1, 0).getDate()

  const diasDoMes = new Date(
    periodEnd.getFullYear(),
    periodEnd.getMonth() + 1,
    0,
  ).getDate()

  // Meta de km/mês por composição (sugestão do usuário 2026-07-25): cada
  // implemento pode ter uma meta própria via parâmetro META_KM_<COMPOSIÇÃO>
  // (Cadastros → Parâmetros); sem parâmetro cadastrado, cai na meta global.
  // Guardado como Parameter comum — sem mudança de schema.
  const compositionSpecs = await prisma.compositionSpec.findMany({ select: { composition: true } })
  const metaKmPorComposicao: Record<string, number> = {}
  for (const spec of compositionSpecs) {
    metaKmPorComposicao[spec.composition] = paramNumber(all, metaParamCode(spec.composition), metaKm, calendar)
  }

  // Fator de conversão TON → MDC por produto (pedido do usuário 2026-08-20:
  // "Para as notas de carvão que a quantidade esta em TON vamos precisar
  // converter em MDC pois por T vamos usar o peso... para cada produto pode
  // criar um parametro de conversão"). Parâmetro FATOR_MDC_<PRODUTO>
  // (Cadastros → Parâmetros); sem parâmetro cadastrado, 0 = não converte
  // (mantém a quantidade separada por unidade, como já era).
  const fatorConversaoMdc: Record<string, number> = {}
  for (const produto of ['Carvão', 'Cavaco', 'Maravalha']) {
    fatorConversaoMdc[produto] = paramNumber(all, fatorMdcParamCode(produto), 0, calendar)
  }

  // Custo do período (pedido do usuário: "o custo é mensal, preciso digitar
  // um valor por mês, não é o mesmo"): parâmetro por mês, código
  // CUSTO_MES_<AAAAMM> (ex.: CUSTO_MES_202607), cadastrado em Cadastros →
  // Parâmetros (ou sincronizado automaticamente da API Controladoria — ver
  // src/lib/sync/post-process.ts). Sem parâmetro para um mês, o custo desse
  // mês é 0. Quando o período cruza a virada do mês, cada mês entra
  // proporcional aos seus dias dentro do período.
  //
  // Projeção do mês CORRENTE (pedido do usuário 2026-07-30): o valor
  // "lançado" do mês em andamento normalmente vem incompleto — a
  // contabilidade não fecha todos os lançamentos no mesmo dia, então
  // CUSTO_MES_<mês corrente> é só "o que já foi lançado até ontem", não o
  // total do mês. Comparamos o custo/dia já lançado com a média histórica
  // dos últimos meses fechados; se estiver muito abaixo (lançamento
  // atrasado), projetamos o mês pela média histórica em vez do valor
  // parcial (que subestimaria o custo real do mês em andamento). "Mostrar o
  // cálculo" (pedido do usuário) expõe cada número usado, não só o
  // resultado.
  const mesAtualYm = mesAtual.replace('-', '')
  const HISTORICO_MESES = 3
  const TOLERANCIA_CUSTO_DIA = 0.85 // até 15% abaixo da média ainda conta como "batendo"
  const mesesHistoricoUsados = all
    .filter((p) => /^CUSTO_MES_\d{6}$/.test(p.code) && p.code !== `CUSTO_MES_${mesAtualYm}` && (p.valueNumber ?? 0) > 0)
    .map((p) => {
      const ym = p.code.replace('CUSTO_MES_', '')
      const y = Number(ym.slice(0, 4))
      const m = Number(ym.slice(4, 6))
      const diasDoMesHistorico = new Date(y, m, 0).getDate()
      const valor = p.valueNumber ?? 0
      return { ym, valor, diasDoMes: diasDoMesHistorico, custoDia: valor / diasDoMesHistorico }
    })
    .sort((a, b) => b.ym.localeCompare(a.ym))
    .slice(0, HISTORICO_MESES)

  const mediaCustoDiaHistorico =
    mesesHistoricoUsados.length > 0
      ? mesesHistoricoUsados.reduce((s, m) => s + m.custoDia, 0) / mesesHistoricoUsados.length
      : null

  const custoMesAtualLancado = paramNumber(all, `CUSTO_MES_${mesAtualYm}`, 0, calendar)
  const custoDiaAtual = cutoffDay > 0 ? custoMesAtualLancado / cutoffDay : 0
  const custoLancadoBateComHistorico =
    mediaCustoDiaHistorico === null || custoMesAtualLancado === 0
      ? null // sem histórico para comparar, ou mês corrente ainda sem nenhum lançamento
      : custoDiaAtual >= mediaCustoDiaHistorico * TOLERANCIA_CUSTO_DIA

  // custoDiaBase = a taxa diária que a gente confia (lançado, se está
  // batendo com o histórico; senão a média histórica).
  const custoDiaBase =
    mediaCustoDiaHistorico === null
      ? custoDiaAtual // sem histórico: não tem outra base, usa o próprio lançado
      : custoLancadoBateComHistorico === false
        ? mediaCustoDiaHistorico
        : custoDiaAtual

  // IMPORTANTE (correção do usuário 2026-07-30): custoMesAtualAteHoje usa
  // `cutoffDay` (dias JÁ DECORRIDOS do mês corrente), não `diasDoMesAtual`
  // (dias do mês inteiro) — o numerador (custo) precisa cobrir a MESMA
  // janela de tempo que o denominador (KM/toneladas das viagens já
  // realizadas) usado nos cards Custo R$/km e R$/tonelada, senão o card fica
  // inflado (custo do mês inteiro projetado ÷ km de só alguns dias). A
  // projeção para o FECHAMENTO do mês (`projetadoFechamento`) é só
  // informativa, mostrada no "ver cálculo" — nunca entra no `custoPeriodo`.
  const custoMesAtualAteHoje = custoDiaBase * cutoffDay
  const custoMesAtualProjetadoFechamento = custoDiaBase * diasDoMesAtual

  // Todos os CUSTO_MES_<AAAAMM> cadastrados, independente do período
  // selecionado (pedido do usuário 2026-08-13: "montar uma aba de análise
  // estratégica por ano... gráfico com o custo do mês") — a aba estratégica
  // precisa do ano inteiro, não só do mês/período em foco no filtro tático.
  const custoMesRegistrado: Record<string, number> = {}
  for (const p of all) {
    if (/^CUSTO_MES_\d{6}$/.test(p.code) && p.valueNumber != null) {
      custoMesRegistrado[p.code.replace('CUSTO_MES_', '')] = p.valueNumber
    }
  }

  // Detalhe por mês do período (pedido do usuário 2026-08-13: "o detalhe do
  // cálculo precisa mostrar de acordo com o filtro... se for um mês fechado
  // com data parcial, pegar proporcional aos dias") — exposto para o "ver
  // cálculo" do front mostrar, mês a mês, o valor cadastrado e a proporção
  // de dias realmente usada, em vez de só o total somado.
  const custoPorMes: {
    ym: string
    valorCadastrado: number
    diasNoPeriodo: number
    diasDoMes: number
    isMesAtual: boolean
    contribuicao: number
  }[] = []

  let custoPeriodo = 0
  for (const { ym, daysInPeriod, daysInMonth } of monthsInRange(from, to)) {
    if (ym === mesAtualYm) {
      // Nunca conta mais dias do que já decorreram de verdade no mês
      // corrente, mesmo que o período selecionado avance até o fim do mês
      // (viagens futuras não existem, o custo correspondente também não).
      const diasContribuintes = Math.min(daysInPeriod, cutoffDay)
      const contribuicao = custoDiaBase * diasContribuintes
      custoPeriodo += contribuicao
      custoPorMes.push({ ym, valorCadastrado: custoMesAtualLancado, diasNoPeriodo: diasContribuintes, diasDoMes: daysInMonth, isMesAtual: true, contribuicao })
    } else {
      const custoMes = paramNumber(all, `CUSTO_MES_${ym}`, 0, calendar)
      const contribuicao = custoMes * (daysInPeriod / daysInMonth)
      custoPeriodo += contribuicao
      custoPorMes.push({ ym, valorCadastrado: custoMes, diasNoPeriodo: daysInPeriod, diasDoMes: daysInMonth, isMesAtual: false, contribuicao })
    }
  }

  // Manutenção (placa) e férias (motorista) sobrepondo o período selecionado
  // (pedido do usuário): o caminhão/motorista continua contando na meta —
  // isso só serve para o painel explicar o desvio de performance.
  // Bug real corrigido 2026-08-27 (usuário Bruno: colocou uma placa em
  // manutenção pelo botão rápido, "não aplicou o início" — placa voltava a
  // aparecer sem manutenção): a condição `startDate <= periodEnd` também
  // excluía um registro EM ABERTO (endDate null) sempre que o filtro de
  // período do painel (`to`) estivesse antes de hoje — o botão rápido sempre
  // cria com `startDate = hoje`, então bastava o usuário estar olhando um
  // período que não alcança hoje (comum: filtro num mês anterior) para o
  // registro recém-criado sumir da lista, mesmo intacto no banco. "Só
  // funcionava com outro usuário" batia porque a sessão de outro usuário
  // normalmente tinha o filtro padrão (mês corrente, `to` = hoje). Um período
  // EM ABERTO (`endDate: null`) é estado ATUAL — sempre entra, independente
  // do filtro; só um período já FECHADO precisa mesmo se sobrepor ao
  // intervalo filtrado para aparecer.
  const [maintenanceRecords, vacationRecords] = await Promise.all([
    prisma.vehicleMaintenance.findMany({
      where: { OR: [{ endDate: null }, { startDate: { lte: periodEnd }, endDate: { gte: fromDate } }] },
    }),
    prisma.driverVacation.findMany({
      where: { OR: [{ endDate: null }, { startDate: { lte: periodEnd }, endDate: { gte: fromDate } }] },
    }),
  ])
  const manutencoes = maintenanceRecords.map((m) => ({
    placa: m.placa,
    aberta: m.endDate === null,
    // Datas reais do período de manutenção (não recortadas pelo filtro) —
    // usadas no card do topo "veículos em manutenção" (pedido do usuário
    // 2026-08-17), que mostra o tempo parado desde sempre, não só a
    // sobreposição com o período filtrado (isso fica em `dias` abaixo).
    startDate: m.startDate.toISOString().slice(0, 10),
    endDate: m.endDate ? m.endDate.toISOString().slice(0, 10) : null,
    previsaoConclusao: m.previsaoConclusao ? m.previsaoConclusao.toISOString().slice(0, 10) : null,
    dias: overlapDays(
      m.startDate.toISOString().slice(0, 10),
      m.endDate ? m.endDate.toISOString().slice(0, 10) : todayStr,
      from,
      to,
    ),
    motivo: m.motivo,
  }))
  const ferias = vacationRecords.map((f) => ({
    motorista: f.motorista,
    aberta: f.endDate === null,
    dias: overlapDays(
      f.startDate.toISOString().slice(0, 10),
      f.endDate ? f.endDate.toISOString().slice(0, 10) : todayStr,
      from,
      to,
    ),
  }))

  // Controle de consumo de combustível (Officium) — pedido do usuário
  // 2026-07-29. Só as placas da frota própria conhecida (mesmo critério do
  // "sem viagem": já teve viagem de frete Próprio) e só os campos usados no
  // km/l, para não pesar o payload com as ~700 placas/equipamentos que a
  // Officium também controla (tratores, colheitadeiras etc., fora do escopo
  // deste painel).
  let abastecimento: { PLACA: string; date: string; pedometer: number; amount: number; produto: string }[] = []
  try {
    const placasProprio = new Set(
      (allTrips as Record<string, unknown>[])
        .filter((t) => t['Consolida Transportadora'] === 'Proprio')
        .map((t) => String(t.PLACA ?? '').trim().toUpperCase()),
    )
    const fuelRows = await getDatasetView('fase1_abastecimento')
    abastecimento = fuelRows
      .filter((r) => placasProprio.has(String(r.PLACA ?? '').trim().toUpperCase()))
      .map((r) => ({
        PLACA: String(r.PLACA ?? '').trim().toUpperCase(),
        date: String(r.date ?? '').slice(0, 10),
        pedometer: Number(r.pedometer) || 0,
        amount: Number(r.amount) || 0,
        // Produto do ABASTECIMENTO (diesel/gasolina/arla32/etc.), não o
        // produto transportado na venda — pedido do usuário 2026-07-30.
        produto: String(r.PRODUTO_ABASTECIMENTO ?? '').trim(),
      }))
  } catch {
    abastecimento = [] // dataset ainda não sincronizado
  }
  const metaConsumoKmL = paramNumber(all, 'META_CONSUMO_KM_L', 2, calendar)
  const ultimaAtualizacao = await getUltimaAtualizacao(['fase1_vendas_transporte', 'fase1_abastecimento'])

  return NextResponse.json({
    period: { from, to },
    ultimaAtualizacao,
    params: {
      metaKm,
      ritmoKm,
      diasDecorridos,
      diasDoMes,
      cutoffDay,
      mesAtual,
      diasDoMesAtual,
      agora: new Date().toISOString(),
      metaKmPorComposicao,
      fatorConversaoMdc,
      custoPeriodo,
      custoPorMes,
      custoMesRegistrado,
      metaConsumoKmL,
      // Transparência da projeção do mês corrente (pedido do usuário
      // 2026-07-30: "demonstrar o cálculo caso clique para saber como
      // chegou no custo por km ou T").
      custoMesAtual: {
        ym: mesAtualYm,
        lancado: custoMesAtualLancado,
        // Usado de fato no custoPeriodo (mesma janela de dias que o
        // KM/toneladas realizados) — nunca o mês inteiro projetado.
        ateHoje: custoMesAtualAteHoje,
        // Só informativo: "no ritmo atual, o mês deve fechar por volta de".
        projetadoFechamento: custoMesAtualProjetadoFechamento,
        custoDiaAtual,
        custoDiaBase,
        mediaCustoDiaHistorico,
        bateComHistorico: custoLancadoBateComHistorico,
        diasDecorridos: cutoffDay,
        diasDoMes: diasDoMesAtual,
        historico: mesesHistoricoUsados,
      },
    },
    trips: allTrips,
    abastecimento,
    manutencoes,
    ferias,
    composicoesAtuais,
    entradaSaidaPlaca: { entrada: entradaPlaca, saida: saidaPlaca },
  })
}
