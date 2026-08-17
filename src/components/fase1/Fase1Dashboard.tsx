'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter, useSearchParams } from 'next/navigation'
import { MonthlyPerformanceChart, FreightPieChart, TripsBarChart, type NameValue } from './Charts'
import { calcularConsumo, agruparConsumoPorMotorista, type ConsumoPlaca } from '@/lib/fase1/fuel'
import { DateRangeInputs, fmtDateBR } from '@/components/shared/DateRangeInputs'
import { CriticaModeloTab } from './CriticaModeloTab'
import { Fase1Estrategico } from './Fase1Estrategico'
import { Fase1Disponibilidade } from './Fase1Disponibilidade'

type Trip = Record<string, unknown>

interface Justificativa {
  motivo: string
  /** Nova previsão de retorno (yyyy-mm-dd), se informada junto com a justificativa */
  novaPrevisao: string | null
}

interface ApiData {
  period: { from: string; to: string }
  params: {
    metaKm: number
    ritmoKm: number
    diasDecorridos: number
    diasDoMes: number
    cutoffDay: number
    mesAtual: string
    diasDoMesAtual: number
    agora: string
    /** Meta de km/mês por composição (Cadastros → Parâmetros, META_KM_<COMPOSIÇÃO>) — sem entrada, usa metaKm */
    metaKmPorComposicao: Record<string, number>
    /** Custo já prorateado para o período selecionado (soma por mês, cada um com seu parâmetro CUSTO_MES_<AAAAMM>) */
    custoPeriodo: number
    /** Detalhe mês a mês do custo do período (pedido do usuário 2026-08-13: mostrar o cálculo de acordo com o filtro, proporcional aos dias quando o mês fechado só entra parcialmente) */
    custoPorMes: {
      ym: string
      /** valor cadastrado em CUSTO_MES_<ym> (ou o lançado/ritmo do mês corrente, antes da proporção de dias) */
      valorCadastrado: number
      diasNoPeriodo: number
      diasDoMes: number
      isMesAtual: boolean
      /** parcela deste mês dentro de custoPeriodo */
      contribuicao: number
    }[]
    /** TODOS os CUSTO_MES_<AAAAMM> cadastrados (não só os do período/filtro selecionado) — usado na aba estratégica por ano */
    custoMesRegistrado: Record<string, number>
    /** Meta de consumo da frota (km/l), Cadastros → Parâmetros META_CONSUMO_KM_L — padrão 2 */
    metaConsumoKmL: number
    /** Transparência da projeção do mês corrente ("ver cálculo" do custo — pedido do usuário 2026-07-30) */
    custoMesAtual: {
      ym: string
      /** valor já lançado do mês corrente (pode estar incompleto — contabilidade atrasada) */
      lancado: number
      /** usado de fato no custoPeriodo (custoDiaBase × dias já decorridos) — mesma janela de tempo do KM/toneladas realizados, nunca o mês inteiro projetado */
      ateHoje: number
      /** só informativo: no ritmo atual (custoDiaBase), quanto o mês deve fechar */
      projetadoFechamento: number
      custoDiaAtual: number
      /** taxa diária usada de fato (lançado, se bate com o histórico; senão a média histórica) */
      custoDiaBase: number
      mediaCustoDiaHistorico: number | null
      /** null = sem histórico para comparar (ou mês corrente ainda sem lançamento) */
      bateComHistorico: boolean | null
      diasDecorridos: number
      diasDoMes: number
      historico: { ym: string; valor: number; diasDoMes: number; custoDia: number }[]
    }
  }
  /** TODAS as viagens enriquecidas — período e dimensões são filtrados aqui no cliente */
  trips: Trip[]
  /** Manutenções de placa sobrepondo o período selecionado (dias já calculados no servidor) */
  manutencoes: {
    placa: string
    aberta: boolean
    startDate: string
    endDate: string | null
    previsaoConclusao: string | null
    dias: number
    motivo: string | null
  }[]
  /** Férias de motorista sobrepondo o período selecionado */
  ferias: { motorista: string; aberta: boolean; dias: number }[]
  /** Abastecimento (Officium) já filtrado à frota própria conhecida — usado no controle km/l */
  abastecimento: { PLACA: string; date: string; pedometer: number; amount: number; produto: string }[]
}

/**
 * "Ver cálculo" dos cards de Custo R$/km e R$/tonelada (pedido do usuário
 * 2026-07-30) — mostra, passo a passo, como o custo do mês corrente foi
 * projetado (lançado × média histórica × dias) e como chegou no resultado
 * final (custo do período ÷ km ou toneladas).
 */
function CalculoCustoDetalhe({
  custoMesAtual,
  custoPorMes,
  custoPeriodo,
  denominadorLabel,
  denominadorValor,
  resultadoLabel,
  resultadoValor,
}: {
  custoMesAtual: ApiData['params']['custoMesAtual']
  custoPorMes: ApiData['params']['custoPorMes']
  custoPeriodo: number
  denominadorLabel: string
  denominadorValor: number
  resultadoLabel: string
  resultadoValor: number
}) {
  // Detalhe mês a mês do período filtrado (pedido do usuário 2026-08-13: "o
  // detalhe dos cálculos precisa mostrar de acordo com o filtro... se for um
  // mês fechado com data parcial, pegar proporcional aos dias") — cada mês
  // do período aparece com seu próprio valor cadastrado e a proporção de
  // dias realmente usada; só o mês corrente (quando está dentro do período)
  // ganha a explicação extra de lançado/projeção, que não se aplica a mês
  // fechado nenhum.
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-xs text-emerald-700 hover:underline">Ver cálculo</summary>
      <div className="mt-2 space-y-2 rounded-md bg-slate-50 p-2 text-[11px] leading-relaxed text-slate-600">
        {custoPorMes.map((m) => {
          const ymFmt = `${m.ym.slice(4, 6)}/${m.ym.slice(0, 4)}`
          if (m.isMesAtual) {
            return (
              <div key={m.ym} className="space-y-1 border-b border-slate-200 pb-2 last:border-0 last:pb-0">
                <p>
                  <strong>{ymFmt} (mês corrente):</strong> lançado até agora R${' '}
                  {fmt(custoMesAtual.lancado, 2)} ({fmt(custoMesAtual.custoDiaAtual, 2)}/dia em{' '}
                  {custoMesAtual.diasDecorridos} dia(s)).
                </p>
                {custoMesAtual.mediaCustoDiaHistorico === null ? (
                  <p>Sem mês anterior lançado para comparar — usando o valor lançado direto, sem projeção.</p>
                ) : (
                  <p>
                    Média histórica: R$ {fmt(custoMesAtual.mediaCustoDiaHistorico, 2)}/dia (
                    {custoMesAtual.historico
                      .map((h) => `${h.ym.slice(4, 6)}/${h.ym.slice(0, 4)}: R$ ${fmt(h.valor, 2)}`)
                      .join(', ')}
                    ) —{' '}
                    {custoMesAtual.bateComHistorico === false
                      ? 'lançado está abaixo da média (contabilidade provavelmente atrasada) → usa a média histórica como taxa diária'
                      : 'lançado bate com a média → usa o próprio ritmo lançado como taxa diária'}
                    : R$ {fmt(custoMesAtual.custoDiaBase, 2)}/dia.
                  </p>
                )}
                <p>
                  <strong>Contribuição deste mês:</strong> R$ {fmt(custoMesAtual.custoDiaBase, 2)}/dia ×{' '}
                  {m.diasNoPeriodo} dia(s) do período (já decorridos) = R$ {fmt(m.contribuicao, 2)} — mesma janela de
                  tempo do KM/toneladas já realizados (nunca o mês inteiro, senão o R$/km ficaria inflado).
                </p>
                <p className="text-slate-400">
                  Só para referência, sem entrar na conta: no ritmo atual, o mês deve fechar por volta de R${' '}
                  {fmt(custoMesAtual.projetadoFechamento, 2)}.
                </p>
              </div>
            )
          }
          const parcial = m.diasNoPeriodo < m.diasDoMes
          return (
            <p key={m.ym}>
              <strong>{ymFmt}:</strong> R$ {fmt(m.valorCadastrado, 2)} cadastrado em Parâmetros
              {parcial ? (
                <>
                  {' '}
                  × ({m.diasNoPeriodo}/{m.diasDoMes} dias do período dentro do mês) = R$ {fmt(m.contribuicao, 2)}
                </>
              ) : (
                <> (mês inteiro dentro do período) = R$ {fmt(m.contribuicao, 2)}</>
              )}
              .
            </p>
          )
        })}
        <p>
          <strong>Custo do período selecionado:</strong> R$ {fmt(custoPeriodo, 2)} (soma das contribuições de cada
          mês acima).
        </p>
        <p>
          <strong>
            {resultadoLabel} = custo do período ÷ {denominadorLabel}:
          </strong>{' '}
          R$ {fmt(custoPeriodo, 2)} ÷ {fmt(denominadorValor, 1)} = R$ {fmt(resultadoValor, 2)}
        </p>
      </div>
    </details>
  )
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

// Dimensões do padrão de cross-filtragem: clique filtra, Ctrl agrupa valores
const DIMENSIONS = {
  frete: 'Consolida Transportadora',
  tipoProduto: 'TipoProduto',
  upc: 'UPC',
  composicao: 'TipoComposição',
  placa: 'PLACA',
  motorista: 'MOTORISTA',
} as const

type DimKey = keyof typeof DIMENSIONS
type Filters = Record<DimKey, string[]>

const DEFAULT_FILTERS: Filters = {
  frete: ['Proprio'], // padrão do painel: sempre fretes próprios
  tipoProduto: ['Carvão', 'Cavaco', 'Maravalha'], // padrão do painel: análise conjunta destes 3
  upc: [],
  composicao: [],
  placa: [],
  motorista: [],
}

const DIM_LABELS: Record<DimKey, string> = {
  frete: 'Frete',
  tipoProduto: 'Produto',
  upc: 'Origem',
  composicao: 'Composição',
  placa: 'Placa',
  motorista: 'Motorista',
}

// Abas espelhadas Por Placa / Por Motorista (padrão de desenvolvimento
// definido em 2026-07-25): qualquer ajuste pedido numa análise agrupada deve
// valer para as duas — a lógica abaixo é parametrizada por groupField
// exatamente para isso. "board" é o acompanhamento simples (ícones por
// caminhão) — não segue essa regra de espelhamento, tem estrutura própria.
type Aba = 'placa' | 'motorista' | 'board' | 'atrasados' | 'combustivel' | 'critica' | 'estrategico' | 'disponibilidade'

// Ícone por classificação de produto no acompanhamento simples
function produtoIcone(tipo: string): string {
  const t = tipo.toUpperCase()
  if (t.includes('CARV')) return '⚫'
  if (t.includes('CAVACO')) return '🪵'
  if (t.includes('MARAVALHA') || t.includes('SERRAGEM')) return '🌾'
  if (t.includes('MADEIRA') || t.includes('MOURAO') || t.includes('PERFIL')) return '🌲'
  return '📦'
}

function monthStart(): string {
  const t = new Date()
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-01`
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

// Rola até uma seção do painel (usado pelo índice do topo e pelos alertas
// que apontam para uma seção específica, ex.: "Conformidade de peso").
function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

const SECOES = [
  { id: 'secao-kpis', label: 'Indicadores' },
  { id: 'secao-graficos', label: 'Gráficos' },
  { id: 'secao-tabela', label: 'Tabela' },
  { id: 'secao-ritmo', label: 'Ritmo acumulado' },
  { id: 'secao-conformidade', label: 'Conformidade de peso' },
  { id: 'secao-inconsistencias', label: 'Inconsistências de composição' },
] as const

function fmt(n: number, digits = 0): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: digits })
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

// Data + hora (não só a data) — pedido do usuário 2026-08-03: "sempre usar
// data hora conforme dados da tabela". `iso` sem "T" (só data, ex.: viagens)
// mostra só a data; com hora (ex.: abastecimento), mostra hh:mm também.
function fmtDateHora(iso: string): string {
  if (!iso.includes('T')) return fmtDate(iso)
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return fmtDate(iso)
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${fmtDate(iso)} ${hh}:${mm}`
}

function countBy(rows: Trip[], field: string): NameValue[] {
  const map = new Map<string, number>()
  for (const r of rows) {
    const k = String(r[field] ?? '—')
    map.set(k, (map.get(k) ?? 0) + 1)
  }
  return [...map.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
}

type TruckStatus = 'EM_DIA' | 'ATRASADO' | 'MUITO_ATRASADO' | 'SEM_ROTA' | 'SEM_VIAGEM'

// Grupo genérico (placa ou motorista) — "assim como foi feito por placa"
// (2026-07-25): a mesma estrutura serve as duas abas espelhadas.
interface TruckSummary {
  key: string
  secondary: string
  viagens: number
  kmAcumulado: number
  pesoMedioT: number
  pesoTotalT: number
  /** Receita esperada de frete (valor de referência cadastrado por rota × km/t/m³/mdc) — NUNCA o VALOR da nota fiscal, que mistura frete e produto */
  receitaEsperadaTotal: number
  ocupacaoPct: number
  ritmoPct: number
  dentroMeta: boolean
  status: TruckStatus
  /** dias no status: em dia/sem rota = dias desde a saída; atrasado = dias além do retorno previsto */
  statusDays: number
  /** Em dia mas perto do vencimento do prazo de retorno (>=85% do caminho) */
  quaseAtrasado: boolean
  /** nº de viagens do grupo com peso acima do limite da composição */
  excessoPesoCount: number
  /** pontuação combinada (ritmo + ocupação + conformidade de peso), 0-100 */
  score: number
  /** só para groupField PLACA: composições distintas nas viagens do período, se houver mais de uma */
  composicoesVariadas: string[] | null
  ultimaSaida: string
  retornoPrevisto: string | null
  /** Chave da última viagem (mesma normalização de src/lib/fase1/trips.ts), usada para justificar atraso */
  ultimaViagemKey: string
  trips: Trip[]
}

const STATUS_STYLE: Record<TruckStatus, { label: string; cls: string; desc: string }> = {
  EM_DIA: {
    label: 'Em dia',
    cls: 'bg-emerald-100 text-emerald-800',
    desc: 'dentro da expectativa da rota (ex.: 2,5 dias Palmyra/Bozel, 5 dias Ferbasa)',
  },
  ATRASADO: {
    label: 'Atrasado',
    cls: 'bg-amber-100 text-amber-800',
    desc: 'passou o retorno previsto em menos de 1 viagem (ex.: rota de 2,5 dias → entre 2,5 e 5 dias fora)',
  },
  MUITO_ATRASADO: {
    label: 'Muito atrasado',
    cls: 'bg-red-100 text-red-700',
    desc: 'atraso já comportaria uma nova viagem (ex.: rota de 2,5 dias → mais de 5 dias fora)',
  },
  SEM_ROTA: {
    label: 'Sem rota',
    cls: 'bg-slate-200 text-slate-600',
    desc: 'destino da última viagem sem rota cadastrada — sem como calcular a expectativa',
  },
  SEM_VIAGEM: {
    label: 'Sem viagem no período',
    cls: 'bg-slate-100 text-slate-500',
    desc: 'está cadastrado, mas não teve nenhuma viagem no período selecionado — pode estar parado',
  },
}

// Colunas da tabela de caminhões: ordenação por clique no cabeçalho e filtro
// por coluna (texto = contém; número aceita ">1000" e "<1000")
interface TruckColumn {
  key: string
  label: string
  numeric: boolean
  align?: 'right'
  value: (t: TruckSummary) => string | number
}

function valorPorKm(t: TruckSummary): number {
  return t.kmAcumulado > 0 ? t.receitaEsperadaTotal / t.kmAcumulado : 0
}

// Espelha os rótulos conforme a aba (Por Placa / Por Motorista)
function columnsFor(
  aba: Aba,
  consumoPorPlaca: Map<string, ConsumoPlaca>,
  consumoPorMotorista: Map<string, { kmPorLitro: number | null; temAlerta: boolean }>,
): TruckColumn[] {
  return [
    { key: 'key', label: aba === 'placa' ? 'Placa' : 'Motorista', numeric: false, value: (t) => t.key },
    { key: 'secondary', label: aba === 'placa' ? 'Composição' : 'Placas dirigidas', numeric: false, value: (t) => t.secondary },
    { key: 'viagens', label: 'Viagens', numeric: true, align: 'right', value: (t) => t.viagens },
    { key: 'km', label: 'KM acumulado', numeric: true, align: 'right', value: (t) => t.kmAcumulado },
    { key: 'peso', label: 'Peso médio (t)', numeric: true, align: 'right', value: (t) => t.pesoMedioT },
    { key: 'valorKm', label: 'R$/km', numeric: true, align: 'right', value: (t) => Math.round(valorPorKm(t) * 100) / 100 },
    {
      key: 'consumo',
      label: 'Consumo (km/l)',
      numeric: true,
      align: 'right',
      value: (t) => {
        const kmPorLitro =
          aba === 'placa' ? consumoPorPlaca.get(t.key)?.kmPorLitro : consumoPorMotorista.get(t.key)?.kmPorLitro
        return kmPorLitro ?? '—'
      },
    },
    { key: 'ocupacao', label: 'Ocupação', numeric: true, align: 'right', value: (t) => t.ocupacaoPct },
    { key: 'ritmo', label: 'Ritmo', numeric: true, align: 'right', value: (t) => t.ritmoPct },
    { key: 'score', label: 'Pontuação', numeric: true, align: 'right', value: (t) => Math.round(t.score) },
    { key: 'status', label: 'Status', numeric: false, value: (t) => STATUS_STYLE[t.status].label },
  ]
}

function matchesColumnFilter(raw: string | number, filter: string, numeric: boolean): boolean {
  const f = filter.trim()
  if (!f) return true
  // "=valor" = igualdade exata (usado pelos cards de status — "Atrasado" não
  // pode casar com "Muito atrasado" por "contém")
  if (f.startsWith('=')) {
    return String(raw).trim().toUpperCase() === f.slice(1).trim().toUpperCase()
  }
  if (numeric || f.startsWith('>') || f.startsWith('<')) {
    const n = Number(raw)
    if (f.startsWith('>')) return n > Number(f.slice(1).replace(',', '.'))
    if (f.startsWith('<')) return n < Number(f.slice(1).replace(',', '.'))
    if (numeric && !Number.isNaN(Number(f.replace(',', '.')))) {
      // número puro em coluna numérica: filtra por "contém" no valor exibido
      return String(Math.round(n)).includes(f.replace(',', '.'))
    }
  }
  // datas exibidas como dd/mm/yyyy: permite filtrar pelo que se vê
  const shown =
    typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw) ? fmtDate(raw) : String(raw)
  return shown.toUpperCase().includes(f.toUpperCase())
}

// groupField = 'PLACA' (aba Por Placa, secondary = composição do último trip)
// ou 'MOTORISTA' (aba Por Motorista, secondary = placas distintas dirigidas —
// um motorista pode rodar em mais de uma placa).
function buildGroupSummaries(
  trips: Trip[],
  params: ApiData['params'],
  referenceNow: number,
  groupField: 'PLACA' | 'MOTORISTA',
): TruckSummary[] {
  const byKey = new Map<string, Trip[]>()
  for (const t of trips) {
    const key = String(t[groupField] ?? '—')
    const list = byKey.get(key)
    if (list) list.push(t)
    else byKey.set(key, [t])
  }

  const agora = referenceNow
  const out: TruckSummary[] = []
  for (const [key, list] of byKey.entries()) {
    const sorted = [...list].sort((a, b) =>
      String(b.DATASAIDA ?? '').localeCompare(String(a.DATASAIDA ?? '')),
    )
    const last = sorted[0]
    const kmAcumulado = list.reduce((s, t) => s + (Number(t.KM_RODADO) || 0), 0)
    const pesoTotal = list.reduce((s, t) => s + (Number(t.PESOLIQUIDO) || 0), 0)
    // Nunca soma VALOR da nota fiscal (mistura frete + produto) — receita de
    // frete vem só do valor de referência contratado por rota, quando houver.
    const receitaEsperadaTotal = list.reduce((s, t) => s + (Number(t.RECEITA_ESPERADA) || 0), 0)
    const horasViagem = list.reduce((s, t) => s + (Number(t.DURACAO_HORAS) || 0), 0)
    const excessoPesoCount = list.filter((t) => t.STATUS_PESO === 'EXCESSO').length

    let status: TruckStatus = 'SEM_ROTA'
    const ret = last.RETORNO_PREVISTO ? new Date(String(last.RETORNO_PREVISTO)).getTime() : null
    const durMs = (Number(last.DURACAO_HORAS) || 0) * 3_600_000
    if (ret !== null) {
      if (agora <= ret) status = 'EM_DIA'
      else if (agora <= ret + durMs) status = 'ATRASADO'
      else status = 'MUITO_ATRASADO'
    }
    // Dias no status: atrasos contam a partir do retorno previsto; em dia e
    // sem rota contam desde a saída da última viagem
    const saidaMs = new Date(`${String(last.DATASAIDA ?? '').slice(0, 10)}T00:00:00`).getTime()
    const statusDays =
      status === 'ATRASADO' || status === 'MUITO_ATRASADO'
        ? (agora - (ret ?? agora)) / 86_400_000
        : (agora - (Number.isFinite(saidaMs) ? saidaMs : agora)) / 86_400_000

    // "Quase atrasado": em dia mas já percorreu 85%+ do caminho até o
    // vencimento do retorno previsto (alerta preventivo antes de vencer).
    let quaseAtrasado = false
    if (status === 'EM_DIA' && ret !== null && Number.isFinite(saidaMs) && ret > saidaMs) {
      const fracao = (agora - saidaMs) / (ret - saidaMs)
      quaseAtrasado = fracao >= 0.85
    }

    const secondary =
      groupField === 'PLACA'
        ? String(last['TipoComposição'] ?? '—')
        : [...new Set(list.map((t) => String(t.PLACA ?? '').trim()).filter(Boolean))].sort().join(' / ')

    // Aderência de composição: só faz sentido por placa — se as viagens do
    // período mostram mais de uma composição resolvida, o cadastro pode
    // estar desatualizado (ou houve mudança real de implemento no meio do
    // período — o usuário decide olhando o detalhe).
    const composicoesVariadas =
      groupField === 'PLACA'
        ? (() => {
            const distintas = [...new Set(list.map((t) => String(t['TipoComposição'] ?? '—')))]
            return distintas.length > 1 ? distintas.sort() : null
          })()
        : null

    // Meta de km/mês: por composição quando a placa tiver parâmetro próprio
    // (META_KM_<COMPOSIÇÃO>), senão a meta global — motorista sempre usa a
    // meta global (não tem uma composição única).
    const metaKmGrupo =
      groupField === 'PLACA' ? (params.metaKmPorComposicao[secondary] ?? params.metaKm) : params.metaKm
    const targetKm = params.diasDoMes > 0 ? metaKmGrupo * (params.diasDecorridos / params.diasDoMes) : metaKmGrupo
    const ritmoPct = targetKm > 0 ? (kmAcumulado / targetKm) * 100 : 0

    // Pontuação combinada (0-100): ritmo + ocupação (cada até 100%) e
    // aproveitamento de peso — meta é sempre rodar o máximo com o máximo de
    // peso dentro do limite (pedido do usuário 2026-07-29). Qualquer excesso
    // zera a pontuação inteira (não é só um desconto — é um limite rígido);
    // sem excesso, quanto mais perto do teto de peso, melhor (carregar mais
    // por viagem, dentro do limite, é sempre melhor que rodar mais leve).
    const comLimitePeso = list.filter((t) => t.STATUS_PESO === 'OK' || t.STATUS_PESO === 'EXCESSO')
    const aproveitamentoPesoPct = comLimitePeso.length
      ? (100 *
          comLimitePeso.reduce((s, t) => {
            const limite = Number(t.PESO_LIMITE_T) || 0
            const pesoViagemT = (Number(t.PESOLIQUIDO) || 0) / 1000
            return s + (limite > 0 ? Math.min(1, pesoViagemT / limite) : 0)
          }, 0)) /
        comLimitePeso.length
      : 100 // nenhuma viagem com limite cadastrado: não penaliza nem beneficia
    const ocupacaoPct = Math.min(150, (horasViagem / 24 / params.diasDecorridos) * 100)
    const score =
      excessoPesoCount > 0
        ? 0
        : Math.min(100, ritmoPct) * 0.4 + Math.min(100, ocupacaoPct) * 0.4 + aproveitamentoPesoPct * 0.2

    out.push({
      key,
      secondary,
      statusDays,
      quaseAtrasado,
      excessoPesoCount,
      composicoesVariadas,
      score,
      viagens: list.length,
      kmAcumulado,
      pesoMedioT: list.length ? pesoTotal / list.length / 1000 : 0,
      pesoTotalT: pesoTotal / 1000,
      receitaEsperadaTotal,
      ocupacaoPct,
      ritmoPct,
      dentroMeta: kmAcumulado >= targetKm,
      status,
      ultimaSaida: String(last.DATASAIDA ?? '').slice(0, 10),
      retornoPrevisto: last.RETORNO_PREVISTO ? String(last.RETORNO_PREVISTO) : null,
      ultimaViagemKey: String(last.VIAGEM_KEY ?? ''),
      trips: sorted,
    })
  }
  return out.sort((a, b) => b.kmAcumulado - a.kmAcumulado)
}

// Acrescenta uma linha "Sem viagem no período" para cada placa cadastrada
// (Cadastros → Composições) que não apareceu nas viagens do período — pedido
// do usuário: caminhões da base sem viagem também precisam ser mostrados e
// acompanhados, não só os que pararam de rodar recentemente.
function withZeroTripEntries(groups: TruckSummary[], placasCadastradas: string[]): TruckSummary[] {
  const known = new Set(groups.map((g) => g.key))
  const extras: TruckSummary[] = placasCadastradas
    .filter((placa) => !known.has(placa))
    .map((placa) => ({
      key: placa,
      secondary: '—',
      viagens: 0,
      kmAcumulado: 0,
      pesoMedioT: 0,
      pesoTotalT: 0,
      receitaEsperadaTotal: 0,
      ocupacaoPct: 0,
      ritmoPct: 0,
      dentroMeta: false,
      status: 'SEM_VIAGEM',
      statusDays: 0,
      quaseAtrasado: false,
      excessoPesoCount: 0,
      score: 0,
      composicoesVariadas: null,
      ultimaSaida: '',
      retornoPrevisto: null,
      ultimaViagemKey: '',
      trips: [],
    }))
  return [...groups, ...extras]
}

// Notificação reconhecível: mostra enquanto a "assinatura" atual (dados que
// identificam o que precisa de atenção) for diferente da última reconhecida
// pelo usuário neste navegador — reaparece se surgir algo novo depois de
// reconhecido. Pedido do usuário: cadastros faltando ajuste (unidades e
// produtos sem classificação) e peso fora do padrão (conformidade).
function useAcknowledgeable(key: string, signature: string | null): [boolean, () => void] {
  const [ackedSignature, setAckedSignature] = useState<string | null>(null)
  useEffect(() => {
    const timer = window.setTimeout(
      () => setAckedSignature(window.localStorage.getItem(`fase1-ack:${key}`)),
      0,
    )
    return () => window.clearTimeout(timer)
  }, [key])
  const visible = signature !== null && signature !== '' && signature !== ackedSignature
  const acknowledge = () => {
    if (signature === null) return
    window.localStorage.setItem(`fase1-ack:${key}`, signature)
    setAckedSignature(signature)
  }
  return [visible, acknowledge]
}

export function Fase1Dashboard() {
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(todayStr())
  const [data, setData] = useState<ApiData | null>(null)
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [aba, setAba] = useState<Aba>('placa')
  // Aba Combustível: Diesel/Arla separados (pedido do usuário 2026-08-14:
  // "crie duas abas no mesmo local e detalhamento separando DIESEL e ARLA") —
  // mesma tabela de consumoPlacas, só troca as colunas exibidas.
  const [combustivelSubTab, setCombustivelSubTab] = useState<'diesel' | 'arla'>('diesel')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [expandedCompliance, setExpandedCompliance] = useState<Set<string>>(new Set())
  // Modal de detalhamento completo da placa/motorista — compartilhado entre a
  // tabela principal e a aba Combustível (pedido do usuário 2026-07-30:
  // clicar na placa em Combustível deve abrir o mesmo detalhamento).
  const [detalheModal, setDetalheModal] = useState<{
    truck: TruckSummary
    otherFieldLabel: string
    otherFieldKey: 'MOTORISTA' | 'PLACA'
    ausencia?: { dias: number; aberta: boolean; motivo?: string | null }
    ausenciaLabel: 'manutenção' | 'férias'
    justificativa?: Justificativa
    consumo?: ConsumoPlaca
  } | null>(null)
  // Alertas no topo do painel começam recolhidos (só a linha-resumo) — clique
  // na seta expande a lista de itens. Pedido do usuário: reduzir o quanto a
  // tela precisa rolar.
  const [alertasExpandidos, setAlertasExpandidos] = useState<Set<string>>(new Set())
  const toggleAlertaExpandido = useCallback((nome: string) => {
    setAlertasExpandidos((prev) => {
      const next = new Set(prev)
      if (next.has(nome)) next.delete(nome)
      else next.add(nome)
      return next
    })
  }, [])
  const [loading, setLoading] = useState(true)
  // Ordenação e filtros por coluna da tabela de caminhões
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'km', dir: 'desc' })
  const [colFilters, setColFilters] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/fase1/data?from=${from}&to=${to}`)
    if (res.ok) setData(await res.json())
    setLoading(false)
  }, [from, to])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  // Justificativas de atraso por viagem (chave = VIAGEM_KEY) — carregadas uma
  // vez; salvar atualiza o mapa local sem precisar recarregar o painel todo.
  // novaPrevisao (opcional): se vencer sem a viagem ser corrigida (mesmo
  // tripKey ainda atrasado), vira um novo alerta — ver promessasVencidas.
  // Também recarregado explicitamente depois de colocar uma placa em
  // manutenção (achado real 2026-08-17: o servidor cria a justificativa
  // automática, mas como este mapa só era buscado uma vez ao montar a
  // página, a linha continuava mostrando "Justificar atraso" até o F5).
  const [justificativas, setJustificativas] = useState<Map<string, Justificativa>>(new Map())
  const loadJustificativas = useCallback(async () => {
    const r = await fetch('/api/admin/trip-justifications')
    if (!r.ok) return
    const rows: { tripKey: string; motivo: string; novaPrevisao: string | null }[] = await r.json()
    setJustificativas(new Map(rows.map((row) => [row.tripKey, { motivo: row.motivo, novaPrevisao: row.novaPrevisao }])))
  }, [])
  useEffect(() => {
    void loadJustificativas()
  }, [loadJustificativas])

  // Recarrega ao voltar para a aba: composição/limite de peso/preço editados
  // em outra tela (Cadastros) precisam refletir aqui sem exigir F5 manual —
  // conformidade de peso é sempre recalculada no servidor a partir do
  // cadastro vigente, então só falta buscar os dados de novo.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible') {
        load()
        void loadJustificativas()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [load, loadJustificativas])

  // Notificações reconhecíveis: cadastros faltando ajuste (unidades e
  // produtos sem classificação) — carregadas uma vez, não dependem do
  // período selecionado.
  const [pendingLocations, setPendingLocations] = useState<
    { coligada: number; filial: number; nomeReal: string; viagens: number }[]
  >([])
  const [pendingProducts, setPendingProducts] = useState<
    { codigoPrd: string; produtoNome: string; movimentos: number }[]
  >([])
  useEffect(() => {
    fetch('/api/admin/locations/pending').then((r) => (r.ok ? r.json() : [])).then(setPendingLocations)
    fetch('/api/admin/product-types/pending').then((r) => (r.ok ? r.json() : [])).then(setPendingProducts)
  }, [])

  const saveJustificativa = useCallback(async (tripKey: string, motivo: string, novaPrevisao: string | null) => {
    const res = await fetch('/api/admin/trip-justifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tripKey, motivo, novaPrevisao }),
    })
    if (res.ok) {
      setJustificativas((prev) => new Map(prev).set(tripKey, { motivo, novaPrevisao }))
    }
    return res.ok
  }, [])

  // Botão rápido iniciar/parar manutenção na lista de veículos (pedido do
  // usuário 2026-08-14) — reaproveita a tela de Cadastros → Manutenção por
  // trás (mesmo model), só sem precisar navegar até lá. `load()` recarrega
  // pra badge/dias refletirem na hora.
  const [manutencaoErro, setManutencaoErro] = useState<string | null>(null)
  const toggleManutencao = useCallback(
    async (placa: string, previsaoConclusao: string | null = null) => {
      setManutencaoErro(null)
      const res = await fetch('/api/fase1/manutencao/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ placa, previsaoConclusao }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setManutencaoErro(`${placa}: ${body.error ?? 'falha ao atualizar manutenção'}`)
        return
      }
      await Promise.all([load(), loadJustificativas()])
    },
    [load, loadJustificativas],
  )

  const pendingLocationsSig = pendingLocations.length
    ? JSON.stringify(pendingLocations.map((p) => `${p.coligada}/${p.filial}`).sort())
    : null
  const pendingProductsSig = pendingProducts.length
    ? JSON.stringify(pendingProducts.map((p) => p.codigoPrd).sort())
    : null
  const [showLocationsAlert, ackLocationsAlert] = useAcknowledgeable('locations', pendingLocationsSig)
  const [showProductsAlert, ackProductsAlert] = useAcknowledgeable('products', pendingProductsSig)

  // Padrão de cross-filtragem: clique substitui a seleção da dimensão;
  // Ctrl+clique agrupa (adiciona/remove da seleção)
  const toggleFilter = useCallback((dim: DimKey, value: string, additive: boolean) => {
    setFilters((prev) => {
      const current = prev[dim]
      let next: string[]
      if (additive) {
        next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
      } else {
        next = current.length === 1 && current[0] === value ? [] : [value]
      }
      return { ...prev, [dim]: next }
    })
  }, [])

  // Viagens do período selecionado (filtro de data aplicado no cliente)
  const periodTrips = useMemo(() => {
    if (!data) return []
    return data.trips.filter((t) => {
      const d = String(t.DATASAIDA ?? '').slice(0, 10)
      return d >= from && d <= to
    })
  }, [data, from, to])

  const matchesDims = useCallback(
    (t: Trip, except?: DimKey) =>
      (Object.keys(DIMENSIONS) as DimKey[]).every((dim) => {
        if (dim === except) return true
        const sel = filters[dim]
        if (sel.length === 0) return true
        return sel.includes(String(t[DIMENSIONS[dim]] ?? '—'))
      }),
    [filters],
  )

  const filteredTrips = useMemo(
    () => periodTrips.filter((t) => matchesDims(t)),
    [periodTrips, matchesDims],
  )

  // Comparativo mensal: respeita os filtros de dimensão (produto, UPC,
  // composição, placa, frete) mas NÃO o período — é uma série entre meses,
  // sempre no mesmo nº de dias (corte em D-1).
  const monthlyComparison = useMemo(() => {
    if (!data) return []
    const { cutoffDay, mesAtual, diasDoMesAtual } = data.params
    const porMes = new Map<string, { km: number; placas: Set<string> }>()
    for (const t of data.trips) {
      if (!matchesDims(t)) continue
      const d = String(t.DATASAIDA ?? '').slice(0, 10)
      if (!d) continue
      if (Number(d.slice(8, 10)) > cutoffDay) continue
      const mes = d.slice(0, 7)
      if (mes > mesAtual) continue
      const acc = porMes.get(mes) ?? { km: 0, placas: new Set<string>() }
      acc.km += Number(t.KM_RODADO) || 0
      acc.placas.add(String(t.PLACA ?? ''))
      porMes.set(mes, acc)
    }
    const ordenado = [...porMes.entries()].sort(([a], [b]) => a.localeCompare(b))
    let kmPorPlacaAnterior: number | null = null
    return ordenado.map(([mes, v]) => {
      const kmPorPlaca = v.placas.size ? Math.round(v.km / v.placas.size) : 0
      // % de ganho/perda do KM médio por placa vs. o mês anterior (pedido do
      // usuário 2026-08-17) — null no primeiro mês da série (sem anterior).
      const variacaoPct =
        kmPorPlacaAnterior !== null && kmPorPlacaAnterior > 0
          ? ((kmPorPlaca - kmPorPlacaAnterior) / kmPorPlacaAnterior) * 100
          : null
      kmPorPlacaAnterior = kmPorPlaca
      return {
        mes,
        label: `${MESES[Number(mes.slice(5, 7)) - 1]}/${mes.slice(2, 4)}`,
        km: Math.round(v.km),
        placas: v.placas.size,
        kmPorPlaca,
        variacaoPct,
        tendencia:
          mes === mesAtual && cutoffDay > 0
            ? Math.round((kmPorPlaca / cutoffDay) * diasDoMesAtual)
            : null,
      }
    })
  }, [data, matchesDims])

  // Viagens por dia da semana + % de ciclos "atrasados": para cada placa,
  // compara o intervalo real até a PRÓXIMA saída com a duração esperada da
  // viagem (DURACAO_HORAS) — se o intervalo real foi maior, aquele ciclo
  // atrasou. Sugestão do usuário: identificar padrão de atraso por dia.
  const weekdayData = useMemo(() => {
    const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
    const porDia = new Map<number, { viagens: number; ciclos: number; atrasados: number }>()
    const byPlaca = new Map<string, Trip[]>()
    for (const t of filteredTrips) {
      const p = String(t.PLACA ?? '')
      const list = byPlaca.get(p)
      if (list) list.push(t)
      else byPlaca.set(p, [t])
    }
    for (const list of byPlaca.values()) {
      const sorted = [...list].sort((a, b) =>
        String(a.DATASAIDA ?? '').localeCompare(String(b.DATASAIDA ?? '')),
      )
      for (let i = 0; i < sorted.length; i++) {
        const t = sorted[i]
        const saida = String(t.DATASAIDA ?? '').slice(0, 10)
        const d = new Date(`${saida}T00:00:00`)
        if (!saida || Number.isNaN(d.getTime())) continue
        const wd = d.getDay()
        const entry = porDia.get(wd) ?? { viagens: 0, ciclos: 0, atrasados: 0 }
        entry.viagens++
        const next = sorted[i + 1]
        const duracaoMs = (Number(t.DURACAO_HORAS) || 0) * 3_600_000
        if (next && duracaoMs > 0) {
          const proximaSaida = new Date(`${String(next.DATASAIDA ?? '').slice(0, 10)}T00:00:00`).getTime()
          const gapMs = proximaSaida - d.getTime()
          entry.ciclos++
          if (gapMs > duracaoMs) entry.atrasados++
        }
        porDia.set(wd, entry)
      }
    }
    return [0, 1, 2, 3, 4, 5, 6].map((wd) => {
      const e = porDia.get(wd) ?? { viagens: 0, ciclos: 0, atrasados: 0 }
      return {
        dia: DIAS[wd],
        viagens: e.viagens,
        ciclos: e.ciclos,
        atrasados: e.atrasados,
        atrasoPct: e.ciclos ? Math.round((e.atrasados / e.ciclos) * 100) : 0,
      }
    })
  }, [filteredTrips])
  // "Ver cálculo" do % de atraso por dia da semana (pedido do usuário 2026-07-30)
  const [diaExplicado, setDiaExplicado] = useState<string | null>(null)

  // Status (Em dia/Atrasado/...) usa a data final do filtro como "agora"
  // quando o período revisado já terminou no passado — senão um período
  // fechado apareceria com todo mundo "muito atrasado" só pelo tempo que
  // passou desde então.
  const referenceNow = useMemo(() => {
    if (!data) return 0
    const agora = new Date(data.params.agora).getTime()
    const fimDoPeriodo = new Date(`${to}T23:59:59`).getTime()
    return Math.min(agora, fimDoPeriodo)
  }, [data, to])

  // placaGroups alimenta os KPIs da frota (sempre por caminhão, independente
  // da aba ativa — ritmo/ocupação/previsão são metas por equipamento, não
  // por motorista). activeGroups é o que a aba selecionada exibe.
  const placaGroups = useMemo(
    () => (data ? buildGroupSummaries(filteredTrips, data.params, referenceNow, 'PLACA') : []),
    [filteredTrips, data, referenceNow],
  )
  const motoristaGroups = useMemo(
    () => (data ? buildGroupSummaries(filteredTrips, data.params, referenceNow, 'MOTORISTA') : []),
    [filteredTrips, data, referenceNow],
  )
  // Frota própria conhecida: placas que já fizeram ao menos uma viagem de
  // frete Próprio em algum momento (histórico completo, não só o período) —
  // pedido do usuário: ignorar placas de terceiros só catalogadas no
  // cadastro de composição, considerar "sem viagem" só quem é frota própria.
  const frotaPropriaConhecida = useMemo(() => {
    if (!data) return []
    const set = new Set<string>()
    for (const t of data.trips) {
      if (String(t['Consolida Transportadora'] ?? '') === 'Proprio') {
        const p = String(t.PLACA ?? '').trim()
        if (p) set.add(p)
      }
    }
    return [...set]
  }, [data])

  // Controle de consumo de combustível (Officium) — pedido do usuário
  // 2026-07-29. km/l pelo hodômetro entre abastecimentos consecutivos da
  // mesma placa (mais preciso que o KM estimado por rota); meta 2 km/l.
  const consumoPlacas = useMemo(
    () =>
      data
        ? calcularConsumo(data.abastecimento, new Set(frotaPropriaConhecida), from, to, data.params.metaConsumoKmL)
        : [],
    [data, frotaPropriaConhecida, from, to],
  )
  const consumoFrota = useMemo(() => {
    const comConsumo = consumoPlacas.filter((c) => c.kmPorLitro !== null)
    const kmTotal = comConsumo.reduce((s, c) => s + c.kmRodado, 0)
    // Litros CONSIDERADOS (só diesel) — usar litrosTotal aqui reintroduziria
    // o mesmo problema do Arla32/lubrificante distorcendo o km/l, já
    // corrigido no cálculo por placa (src/lib/fase1/fuel.ts).
    const litrosConsiderados = comConsumo.reduce((s, c) => s + c.litrosConsiderados, 0)
    return {
      kmPorLitro: litrosConsiderados > 0 ? kmTotal / litrosConsiderados : null,
      abaixoDaMeta: comConsumo.filter((c) => (c.kmPorLitro ?? Infinity) < (data?.params.metaConsumoKmL ?? 2)).length,
      placasComDados: comConsumo.length,
    }
  }, [consumoPlacas, data])
  const consumoPorPlaca = useMemo(() => new Map(consumoPlacas.map((c) => [c.placa, c])), [consumoPlacas])
  // Linha do tempo de motorista por placa (pedido do usuário 2026-07-30):
  // "equivalência da data do abastecimento com o período entre duas notas —
  // emite nota hoje, todo abastecimento até aparecer nota de outro motorista
  // é dele". Usa TODO o histórico de viagens (`data.trips`, não só o período
  // filtrado) para saber quem dirigia mesmo em abastecimentos de referência
  // anteriores ao período. Chave da placa igual à de `consumoPorPlaca`
  // (maiúscula/trim); motorista fica com o valor bruto (mesma fonte de
  // `t.MOTORISTA` usado em `buildGroupSummaries`, sem normalizar) para bater
  // exatamente com a chave (`t.key`) da aba Por Motorista.
  const motoristaTimelinePorPlaca = useMemo(() => {
    const map = new Map<string, { data: string; motorista: string }[]>()
    if (!data) return map
    for (const t of data.trips as Record<string, unknown>[]) {
      const placa = String(t.PLACA ?? '').trim().toUpperCase()
      const motorista = String(t.MOTORISTA ?? '')
      const dataSaida = String(t.DATASAIDA ?? '').slice(0, 10)
      if (!placa || !motorista || !dataSaida) continue
      const list = map.get(placa) ?? []
      list.push({ data: dataSaida, motorista })
      map.set(placa, list)
    }
    for (const list of map.values()) list.sort((a, b) => a.data.localeCompare(b.data))
    return map
  }, [data])
  // Consumo por MOTORISTA: cada abastecimento vai para o motorista da nota
  // mais recente da mesma placa até aquela data (não mais uma soma de todas
  // as placas dirigidas no período — atribuição por data, pedido do usuário).
  const consumoPorMotorista = useMemo(
    () => new Map(agruparConsumoPorMotorista(consumoPlacas, motoristaTimelinePorPlaca).map((c) => [c.motorista, c])),
    [consumoPlacas, motoristaTimelinePorPlaca],
  )

  // placaGroupsFull inclui a frota própria sem viagem no período (status
  // SEM_VIAGEM) — usado para exibição (tabela, board, quadro de status), mas
  // NUNCA para as contas de KPI da frota (placaGroups continua só com quem
  // rodou de fato).
  const placaGroupsFull = useMemo(
    () => withZeroTripEntries(placaGroups, frotaPropriaConhecida),
    [placaGroups, frotaPropriaConhecida],
  )
  // "board" (acompanhamento simples) reaproveita os grupos por placa (com sumidos)
  const activeGroups = aba === 'motorista' ? motoristaGroups : placaGroupsFull
  const activeDim: DimKey = aba === 'motorista' ? 'motorista' : 'placa'
  const columns = useMemo(
    () => columnsFor(aba === 'motorista' ? 'motorista' : 'placa', consumoPorPlaca, consumoPorMotorista),
    [aba, consumoPorPlaca, consumoPorMotorista],
  )

  // Aplica filtros de coluna e ordenação escolhidos no cabeçalho da tabela
  const visibleGroups = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key) ?? columns[3]
    const filtered = activeGroups.filter((t) =>
      columns.every((c) => matchesColumnFilter(c.value(t), colFilters[c.key] ?? '', c.numeric)),
    )
    return [...filtered].sort((a, b) => {
      const va = col.value(a)
      const vb = col.value(b)
      const cmp = col.numeric
        ? Number(va) - Number(vb)
        : String(va).localeCompare(String(vb), 'pt-BR')
      return sort.dir === 'asc' ? cmp : -cmp
    })
  }, [activeGroups, columns, sort, colFilters])

  const toggleSort = useCallback((key: string) => {
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' },
    )
  }, [])

  const kpis = useMemo(() => {
    // KPIs da frota são sempre por CAMINHÃO (placaGroups), independente da
    // aba ativa — ritmo/ocupação/previsão são metas por equipamento.
    const kmTotal = placaGroups.reduce((s, t) => s + t.kmAcumulado, 0)
    // Unidade de controle do painel: PESO LÍQUIDO (t), não volume
    const pesoT = filteredTrips.reduce((s, t) => s + (Number(t.PESOLIQUIDO) || 0), 0) / 1000
    // Ritmo médio da frota: média do ritmo individual (cada placa já pode ter
    // meta própria por composição — ver Cadastros → Parâmetros)
    const ritmoFrota = placaGroups.length
      ? placaGroups.reduce((s, t) => s + t.ritmoPct, 0) / placaGroups.length
      : 0
    // Ocupação da frota: média das ocupações por caminhão
    const ocupacaoFrota = placaGroups.length
      ? placaGroups.reduce((s, t) => s + t.ocupacaoPct, 0) / placaGroups.length
      : 0
    // Projeção de fechamento do mês mantendo o ritmo atual
    const kmProjetado = data
      ? (kmTotal / data.params.diasDecorridos) * data.params.diasDoMes
      : 0
    const kmProjetadoPorCaminhao = placaGroups.length ? kmProjetado / placaGroups.length : 0
    // Mesmo raciocínio do kmProjetado acima, para peso — usado no custo
    // R$/tonelada ESTIMADO (pedido do usuário 2026-08-13: "para o mês atual
    // não fechado precisa trazer o custo KM ou T do estimado").
    const pesoProjetado = data ? (pesoT / data.params.diasDecorridos) * data.params.diasDoMes : 0
    // Previsão de nº de viagens no fechamento, mesmo raciocínio do KM
    const viagensProjetadas = data
      ? (filteredTrips.length / data.params.diasDecorridos) * data.params.diasDoMes
      : 0
    // Custo do período: já vem prorateado do servidor, um parâmetro
    // CUSTO_MES_<AAAAMM> por mês (não um valor único fixo).
    const custoDoPeriodo = data ? data.params.custoPeriodo : 0

    // Receita de frete: NUNCA o VALOR da nota fiscal (mistura frete e
    // produto, não serve para medir receita de frete). Soma RECEITA_ESPERADA
    // (valor de referência cadastrado por rota × km/tonelada/mdc/m³,
    // conforme a unidade de cada rota) — só para viagens com rota
    // precificada em Cadastros → Preços de frete (pedido do usuário
    // 2026-07-29). Sempre em tempo real (`filteredTrips`, sem corte de dia
    // anterior) — correção do usuário 2026-08-14: o corte D-1/18h ("dados de
    // NF só fecham às 18h") é um conceito específico da Fase 3 (venda de
    // madeira tratada); em Transporte Rodoviário o único comparativo que usa
    // D-1 é o gráfico "Performance vs meses anteriores" (KM médio por
    // placa), não Receita/Margem. Uma sessão anterior aplicou esse corte
    // aqui por engano, revertido nesta correção.
    const comReferencia = filteredTrips.filter((t) => t.RECEITA_ESPERADA !== null)
    const receitaEsperadaTotal = comReferencia.reduce((s, t) => s + (Number(t.RECEITA_ESPERADA) || 0), 0)
    const kmComReferencia = comReferencia.reduce((s, t) => s + (Number(t.KM_RODADO) || 0), 0)
    const pesoComReferencia = comReferencia.reduce((s, t) => s + (Number(t.PESOLIQUIDO) || 0), 0) / 1000

    const valorPorKm = kmComReferencia > 0 ? receitaEsperadaTotal / kmComReferencia : 0
    const valorPorTonelada = pesoComReferencia > 0 ? receitaEsperadaTotal / pesoComReferencia : 0
    const custoPorKm = kmTotal > 0 ? custoDoPeriodo / kmTotal : 0
    const custoPorTonelada = pesoT > 0 ? custoDoPeriodo / pesoT : 0
    // Custo ESTIMADO por km/tonelada — pedido do usuário 2026-08-13: "para o
    // mês atual não fechado precisa trazer o custo KM ou T do estimado".
    // custoPorKm/custoPorTonelada acima usam custoDoPeriodo (só o já
    // decorrido); aqui a projeção de FECHAMENTO do custo (custoMesAtual.
    // projetadoFechamento) é dividida pelo KM/peso também projetados no
    // mesmo ritmo (kmProjetado/pesoProjetado) — as duas pontas da conta
    // projetadas juntas, não uma projetada contra a outra realizada.
    const mesAberto = data ? data.params.custoMesAtual.diasDecorridos < data.params.custoMesAtual.diasDoMes : false
    const custoPorKmEstimado =
      mesAberto && data && kmProjetado > 0 ? data.params.custoMesAtual.projetadoFechamento / kmProjetado : null
    const custoPorToneladaEstimado =
      mesAberto && data && pesoProjetado > 0 ? data.params.custoMesAtual.projetadoFechamento / pesoProjetado : null

    return {
      viagens: filteredTrips.length,
      pesoT,
      kmTotal,
      ritmoFrota,
      ocupacaoFrota,
      kmProjetado,
      kmProjetadoPorCaminhao,
      pesoProjetado,
      viagensProjetadas,
      valorPorKm,
      valorPorTonelada,
      custoPorKm,
      custoPorTonelada,
      mesAberto,
      custoPorKmEstimado,
      custoPorToneladaEstimado,
      // Margem = receita esperada (rota) − custo, no mesmo período — mostra
      // se o mês está acima ou abaixo do custo (pedido do usuário).
      margemPorKm: custoDoPeriodo > 0 && kmComReferencia > 0 ? valorPorKm - custoPorKm : null,
      margemPorTonelada: custoDoPeriodo > 0 && pesoComReferencia > 0 ? valorPorTonelada - custoPorTonelada : null,
      viagensComReferencia: comReferencia.length,
    }
  }, [filteredTrips, placaGroups, data])

  // "Sumidos": placas/motoristas com viagem nos últimos 30 dias (mesmos
  // filtros de dimensão) mas nenhuma no período selecionado — pode indicar
  // caminhão parado/quebrado ou motorista afastado.
  // Só para motorista: placa "sumida" já vira linha na tabela com status
  // SEM_VIAGEM (withZeroTripEntries), a partir do cadastro de Composições.
  const sumidos = useMemo(() => {
    if (!data || aba !== 'motorista') return []
    const groupField = 'MOTORISTA' as const
    const refStart = new Date(new Date(`${to}T00:00:00`).getTime() - 30 * 86_400_000)
      .toISOString()
      .slice(0, 10)
    const lastSeen = new Map<string, string>()
    for (const t of data.trips) {
      if (!matchesDims(t)) continue
      const d = String(t.DATASAIDA ?? '').slice(0, 10)
      if (!d || d < refStart || d > to) continue
      const key = String(t[groupField] ?? '—')
      const prev = lastSeen.get(key)
      if (!prev || d > prev) lastSeen.set(key, d)
    }
    const activeKeys = new Set(activeGroups.map((g) => g.key))
    return [...lastSeen.entries()]
      .filter(([key]) => !activeKeys.has(key))
      .map(([key, lastDate]) => ({ key, lastDate }))
      .sort((a, b) => b.lastDate.localeCompare(a.lastDate))
  }, [data, matchesDims, to, aba, activeGroups])

  // Aba "Atrasados justificados": placas atrasadas/muito atrasadas cuja
  // última viagem JÁ tem justificativa registrada — pedido do usuário
  // 2026-07-29, visão dedicada para revisar o que já foi explicado.
  const atrasadosJustificados = useMemo(
    () =>
      placaGroupsFull
        .filter(
          (g) =>
            (g.status === 'ATRASADO' || g.status === 'MUITO_ATRASADO') &&
            justificativas.has(g.ultimaViagemKey),
        )
        .map((g) => ({ group: g, justificativa: justificativas.get(g.ultimaViagemKey)! }))
        .sort((a, b) => b.group.statusDays - a.group.statusDays),
    [placaGroupsFull, justificativas],
  )

  // "Promessa vencida": a nova previsão informada na justificativa já passou
  // e a viagem continua sem correção (mesma viagem ainda atrasada, nenhuma
  // viagem nova aconteceu) — gera um novo alerta individual por placa.
  const promessasVencidas = useMemo(
    () =>
      atrasadosJustificados.filter(({ justificativa }) => {
        if (!justificativa.novaPrevisao) return false
        return referenceNow > new Date(`${justificativa.novaPrevisao.slice(0, 10)}T23:59:59`).getTime()
      }),
    [atrasadosJustificados, referenceNow],
  )
  const promessasVencidasSig = promessasVencidas.length
    ? JSON.stringify(promessasVencidas.map(({ group }) => group.ultimaViagemKey).sort())
    : null
  const [showPromessasAlert, ackPromessasAlert] = useAcknowledgeable('promessas-vencidas', promessasVencidasSig)

  // Exporta a tabela visível (Por Placa/Por Motorista) em CSV, respeitando
  // ordenação e filtros de coluna atuais.
  const exportCsv = useCallback(() => {
    const header = columns.map((c) => c.label).join(';')
    const rows = visibleGroups.map((g) => columns.map((c) => String(c.value(g)).replace(/;/g, ',')).join(';'))
    const csv = '﻿' + [header, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${aba === 'placa' ? 'caminhoes' : 'motoristas'}_${to}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [columns, visibleGroups, aba, to])

  // Manutenção por placa / férias por motorista no período (dias já vêm
  // somados por sobreposição do servidor) — usados para badge nas linhas e
  // para os cards de desvio de performance.
  const manutencaoPorPlaca = useMemo(() => {
    const map = new Map<string, { dias: number; aberta: boolean; motivo: string | null }>()
    if (!data) return map
    for (const m of data.manutencoes) {
      const prev = map.get(m.placa)
      map.set(m.placa, {
        dias: (prev?.dias ?? 0) + m.dias,
        aberta: (prev?.aberta ?? false) || m.aberta,
        motivo: m.motivo ?? prev?.motivo ?? null,
      })
    }
    return map
  }, [data])

  // Card do topo "veículos em manutenção" (pedido do usuário 2026-08-17) —
  // tempo parado desde o início real da manutenção (não recortado pelo
  // período filtrado, diferente de manutencaoPorPlaca acima).
  const manutencoesAbertas = useMemo(() => {
    if (!data) return []
    const hoje = new Date().toISOString().slice(0, 10)
    return [...data.manutencoes]
      .filter((m) => m.aberta)
      .map((m) => ({
        ...m,
        diasParado: Math.max(0, Math.floor((Date.parse(hoje) - Date.parse(m.startDate)) / 86_400_000)),
      }))
      .sort((a, b) => b.diasParado - a.diasParado)
  }, [data])

  // Abre o modal de detalhamento direto ao chegar via link externo (pedido
  // do usuário 2026-08-12: botão "ver viagem" no balão do mapa de
  // Rastreamento) — /dashboard/fase1?abrirDetalhe=PLACA. Mesma lógica do
  // clique no card de Acompanhamento (linha ~1725), só que disparada pela
  // URL em vez de um clique. Limpa o parâmetro depois de abrir, para um F5
  // não reabrir o modal sozinho.
  const router = useRouter()
  const searchParams = useSearchParams()
  useEffect(() => {
    const placaAlvo = searchParams.get('abrirDetalhe')
    if (!placaAlvo || loading) return
    const tr = placaGroupsFull.find((t) => t.key === placaAlvo)
    if (tr) {
      setDetalheModal({
        truck: tr,
        otherFieldLabel: 'Motorista',
        otherFieldKey: 'MOTORISTA',
        ausencia: manutencaoPorPlaca.get(tr.key),
        ausenciaLabel: 'manutenção',
        justificativa: justificativas.get(tr.ultimaViagemKey),
        consumo: consumoPorPlaca.get(tr.key),
      })
    }
    router.replace('/dashboard/fase1', { scroll: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, placaGroupsFull, searchParams])

  const feriasPorMotorista = useMemo(() => {
    const map = new Map<string, { dias: number; aberta: boolean }>()
    if (!data) return map
    for (const f of data.ferias) {
      const prev = map.get(f.motorista)
      map.set(f.motorista, { dias: (prev?.dias ?? 0) + f.dias, aberta: (prev?.aberta ?? false) || f.aberta })
    }
    return map
  }, [data])

  // Desvio de performance por manutenção: dias parados × ritmo esperado por
  // dia (taxa global — não distingue composição da placa parada, é uma
  // estimativa) — pedido do usuário: entender o quanto a manutenção pesa no
  // resultado, sem excluir o caminhão da meta.
  const manutencaoKpis = useMemo(() => {
    const diasTotal = [...manutencaoPorPlaca.values()].reduce((s, m) => s + m.dias, 0)
    const taxaDiaria = data && data.params.diasDoMes > 0 ? data.params.metaKm / data.params.diasDoMes : 0
    return { diasTotal, kmPerdido: diasTotal * taxaDiaria, placas: manutencaoPorPlaca.size }
  }, [manutencaoPorPlaca, data])

  const activeChips = (Object.keys(DIMENSIONS) as DimKey[]).flatMap((dim) =>
    filters[dim].map((v) => ({ dim, value: v })),
  )

  // Conformidade de peso: viagens cujo peso líquido superou o limite de carga
  // líquida cadastrado para a composição vigente (ver Cadastros → Composições).
  const overweightTrips = useMemo(
    () =>
      filteredTrips
        .filter((t) => t.STATUS_PESO === 'EXCESSO')
        .sort((a, b) => (Number(b.PESO_EXCESSO_T) || 0) - (Number(a.PESO_EXCESSO_T) || 0)),
    [filteredTrips],
  )
  const overweightSig = overweightTrips.length
    ? JSON.stringify(overweightTrips.map((t) => `${t.DATASAIDA}|${t.PLACA}|${t.NOMEFANTASIA}`).sort())
    : null
  const [showWeightAlert, ackWeightAlert] = useAcknowledgeable('weight', overweightSig)

  // Inconsistência de composição: viagem com 2+ notas fiscais agrupadas (só
  // RodoTrem puxa dois semirreboques) mas a placa está cadastrada com OUTRA
  // composição — pode ser um RodoTrem fora do cadastro, ou duas viagens
  // físicas distintas que o agrupamento por dia/placa juntou por engano
  // (pedido do usuário 2026-07-29, a partir do caso da placa SES5B33).
  const inconsistentTrips = useMemo(
    () =>
      filteredTrips
        .filter((t) => t.COMPOSICAO_INCONSISTENTE)
        .sort((a, b) => String(b.DATASAIDA ?? '').localeCompare(String(a.DATASAIDA ?? ''))),
    [filteredTrips],
  )
  const inconsistentSig = inconsistentTrips.length
    ? JSON.stringify(inconsistentTrips.map((t) => `${t.DATASAIDA}|${t.PLACA}|${t.NOMEFANTASIA}`).sort())
    : null
  const [showInconsistentAlert, ackInconsistentAlert] = useAcknowledgeable('composicao-inconsistente', inconsistentSig)

  // Combustível fora do padrão: pedido do usuário 2026-07-29 — "função de
  // notificação para apontar os desvios com fácil acesso de identificação".
  // Lista cada placa com alerta individualmente (não só uma contagem).
  const consumoComAlerta = useMemo(() => consumoPlacas.filter((c) => c.temAlerta), [consumoPlacas])
  const consumoCriticoCount = useMemo(
    () => consumoComAlerta.filter((c) => c.nivelAnormalidade === 'critico').length,
    [consumoComAlerta],
  )
  const consumoAlertaSig = consumoComAlerta.length
    ? JSON.stringify(consumoComAlerta.map((c) => `${c.placa}:${c.scoreAnormalidade}`).sort())
    : null
  const [showConsumoAlert, ackConsumoAlert] = useAcknowledgeable('consumo-fora-padrao', consumoAlertaSig)

  if (loading && !data) {
    return <p className="py-16 text-center text-slate-500">Carregando dados…</p>
  }
  if (!data) {
    return <p className="py-16 text-center text-red-600">Falha ao carregar os dados do painel.</p>
  }

  const hasNotifications =
    showLocationsAlert ||
    showProductsAlert ||
    showWeightAlert ||
    showInconsistentAlert ||
    showPromessasAlert ||
    showConsumoAlert

  return (
    <div className="space-y-6">
      {manutencoesAbertas.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-sm font-medium text-amber-900">
            🔧 {manutencoesAbertas.length} veículo(s) em manutenção — ver Cadastros → Manutenção
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {manutencoesAbertas.map((m) => (
              <span
                key={m.placa}
                title={m.motivo ?? undefined}
                className="rounded-md bg-white px-2 py-1 text-xs text-amber-900 shadow-sm"
              >
                <span className="font-mono font-semibold">{m.placa}</span> — {m.diasParado}{' '}
                {m.diasParado === 1 ? 'dia' : 'dias'} parado
                {m.previsaoConclusao && (
                  <span className="text-amber-700">
                    {' '}
                    (previsão: {m.previsaoConclusao.slice(8, 10)}/{m.previsaoConclusao.slice(5, 7)})
                  </span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}
      {hasNotifications && (
        <div className="space-y-2">
          {showLocationsAlert && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm">
              <span className="text-amber-900">
                ⚠ {pendingLocations.length} unidade(s) sem cadastro de Local — ver Cadastros → Locais
              </span>
              <button onClick={ackLocationsAlert} className="shrink-0 text-xs text-amber-800 underline hover:text-amber-900">
                reconhecer
              </button>
            </div>
          )}
          {showProductsAlert && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm">
              <span className="text-amber-900">
                ⚠ {pendingProducts.length} produto(s) sem classificação — ver Cadastros → Produtos
              </span>
              <button onClick={ackProductsAlert} className="shrink-0 text-xs text-amber-800 underline hover:text-amber-900">
                reconhecer
              </button>
            </div>
          )}
          {showWeightAlert && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm">
              <span className="text-red-800">
                ⚠ {overweightTrips.length} viagem(ns) com peso fora do limite no período —{' '}
                <button
                  onClick={() => scrollToSection('secao-conformidade')}
                  className="underline hover:text-red-900"
                >
                  ver seção “Conformidade de peso”
                </button>
              </span>
              <button onClick={ackWeightAlert} className="shrink-0 text-xs text-red-700 underline hover:text-red-900">
                reconhecer
              </button>
            </div>
          )}
          {showInconsistentAlert && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-orange-300 bg-orange-50 px-4 py-2 text-sm">
              <span className="text-orange-900">
                ⚠ {inconsistentTrips.length} viagem(ns) com notas fiscais inconsistentes (3+ no
                mesmo dia, ou 2 numa placa que não é RodoTrem) —{' '}
                <button
                  onClick={() => scrollToSection('secao-inconsistencias')}
                  className="underline hover:text-orange-950"
                >
                  ver seção “Inconsistências de composição”
                </button>
              </span>
              <button onClick={ackInconsistentAlert} className="shrink-0 text-xs text-orange-800 underline hover:text-orange-950">
                reconhecer
              </button>
            </div>
          )}
          {showPromessasAlert && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-red-900">
                  <button
                    onClick={() => toggleAlertaExpandido('promessas')}
                    className="mr-1 text-red-700 hover:text-red-900"
                    title={alertasExpandidos.has('promessas') ? 'Recolher' : 'Ver detalhe'}
                  >
                    {alertasExpandidos.has('promessas') ? '▾' : '▸'}
                  </button>
                  ⚠ {promessasVencidas.length} previsão(ões) de retorno vencida(s) sem correção —{' '}
                  <button
                    onClick={() => {
                      setAba('atrasados')
                      scrollToSection('secao-tabela')
                    }}
                    className="underline hover:text-red-950"
                  >
                    ver aba “Atrasados justificados”
                  </button>
                </span>
                <button onClick={ackPromessasAlert} className="shrink-0 text-xs text-red-700 underline hover:text-red-900">
                  reconhecer
                </button>
              </div>
              {alertasExpandidos.has('promessas') && (
                <ul className="mt-1 space-y-0.5 text-red-800">
                  {promessasVencidas.map(({ group, justificativa }) => (
                    <li key={group.ultimaViagemKey}>
                      <span className="font-mono font-medium">{group.key}</span> — previsão era{' '}
                      {fmtDate(justificativa.novaPrevisao!)}, ainda sem viagem nova ({fmt(group.statusDays, 1)}{' '}
                      dia(s) de atraso) — &quot;{justificativa.motivo}&quot;
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {showConsumoAlert && (
            <div className="rounded-lg border border-orange-300 bg-orange-50 px-4 py-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-orange-900">
                  <button
                    onClick={() => toggleAlertaExpandido('consumo')}
                    className="mr-1 text-orange-700 hover:text-orange-900"
                    title={alertasExpandidos.has('consumo') ? 'Recolher' : 'Ver detalhe'}
                  >
                    {alertasExpandidos.has('consumo') ? '▾' : '▸'}
                  </button>
                  ⚠ {consumoComAlerta.length} placa(s) com consumo fora do normal
                  {consumoCriticoCount > 0 && (
                    <span className="font-semibold text-red-700"> ({consumoCriticoCount} crítica(s))</span>
                  )}{' '}
                  —{' '}
                  <button
                    onClick={() => {
                      setAba('combustivel')
                      scrollToSection('secao-tabela')
                    }}
                    className="underline hover:text-orange-950"
                  >
                    ver aba “Combustível”
                  </button>
                </span>
                <button onClick={ackConsumoAlert} className="shrink-0 text-xs text-orange-800 underline hover:text-orange-950">
                  reconhecer
                </button>
              </div>
              {alertasExpandidos.has('consumo') && (
                <ul className="mt-1 space-y-0.5 text-orange-800">
                  {consumoComAlerta.map((c) => (
                    <li key={c.placa}>
                      <span className="font-mono font-medium">{c.placa}</span>
                      {c.kmPorLitro !== null && ` — ${fmt(c.kmPorLitro, 2)} km/l no período`}
                      {' — '}
                      <span
                        className={c.nivelAnormalidade === 'critico' ? 'font-semibold text-red-700' : 'text-orange-700'}
                        title="score = % dos abastecimentos do período com consumo fora do padrão"
                      >
                        anormalidade {c.scoreAnormalidade}%{c.nivelAnormalidade === 'critico' && ' — crítico (padrão recorrente, possível sensor quebrado ou fraude)'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Fase 1</p>
          <h1 className="text-xl font-semibold">Transporte Rodoviário</h1>
          <p className="text-sm text-slate-500">
            Clique nos gráficos/tabela para filtrar; Ctrl+clique agrupa valores.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <DateRangeInputs from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
          <button
            onClick={load}
            disabled={loading}
            title="Recarrega os dados do período — inclui composições, limites de peso e demais cadastros mais recentes"
            className="mb-[1px] rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-50"
          >
            {loading ? 'Atualizando…' : '↻ Atualizar'}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1 text-xs">
        <span className="text-slate-500">Ir para:</span>
        {SECOES.map((s) => (
          <button
            key={s.id}
            onClick={() => scrollToSection(s.id)}
            className="rounded-full border border-slate-300 px-2.5 py-1 text-slate-600 hover:bg-slate-100"
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-500">Filtros:</span>
        {activeChips.length === 0 && <span className="text-slate-400">nenhum</span>}
        {activeChips.map(({ dim, value }) => (
          <button
            key={`${dim}:${value}`}
            onClick={() => toggleFilter(dim, value, true)}
            className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-800 hover:bg-emerald-200"
            title="Clique para remover"
          >
            {DIM_LABELS[dim]}: {value} ✕
          </button>
        ))}
        {activeChips.length > 0 && (
          <button
            onClick={() =>
              setFilters({ frete: [], tipoProduto: [], upc: [], composicao: [], placa: [], motorista: [] })
            }
            className="text-slate-500 underline hover:text-slate-700"
          >
            limpar tudo
          </button>
        )}
        {loading && <span className="text-slate-400">atualizando…</span>}
      </div>

      {/* Cards simples (só número, sem explicação) — mais compactos */}
      <div id="secao-kpis" className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">Viagens</p>
          <p className="mt-1 text-2xl font-semibold text-emerald-700">{fmt(kpis.viagens)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">Peso líquido transportado (t)</p>
          <p className="mt-1 text-2xl font-semibold text-emerald-700">{fmt(kpis.pesoT)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">KM rodado (ida+volta)</p>
          <p className="mt-1 text-2xl font-semibold text-emerald-700">{fmt(kpis.kmTotal)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">Consumo médio (km/l)</p>
          <p
            className={`mt-1 text-2xl font-semibold ${consumoFrota.kmPorLitro === null ? 'text-slate-400' : consumoFrota.kmPorLitro >= data.params.metaConsumoKmL ? 'text-emerald-700' : 'text-red-600'}`}
          >
            {consumoFrota.kmPorLitro === null ? '—' : fmt(consumoFrota.kmPorLitro, 2)}
          </p>
          <p className="text-[11px] text-slate-400">
            {consumoFrota.kmPorLitro === null
              ? 'sem abastecimento no período'
              : `meta ${fmt(data.params.metaConsumoKmL, 2)} · ${consumoFrota.abaixoDaMeta} placa(s) abaixo — clique na placa na tabela para o detalhe`}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">Receita R$/km</p>
          <p className="mt-1 text-2xl font-semibold text-emerald-700">
            {kpis.viagensComReferencia > 0 ? fmt(kpis.valorPorKm, 2) : '—'}
          </p>
          <p className="text-[11px] text-slate-400">
            {kpis.viagensComReferencia > 0
              ? `valor de referência da rota (${kpis.viagensComReferencia} viagem(ns) precificada(s))`
              : 'cadastre em Cadastros → Preços de frete'}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">Receita R$/tonelada</p>
          <p className="mt-1 text-2xl font-semibold text-emerald-700">
            {kpis.viagensComReferencia > 0 ? fmt(kpis.valorPorTonelada, 2) : '—'}
          </p>
          <p className="text-[11px] text-slate-400">
            {kpis.viagensComReferencia > 0
              ? `valor de referência da rota (nunca a nota fiscal, que mistura frete e produto)`
              : 'cadastre em Cadastros → Preços de frete'}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">Custo Total (integração)</p>
          <p className="mt-1 text-2xl font-semibold text-slate-700">R$ {fmt(data.params.custoPeriodo, 2)}</p>
          <p className="text-[11px] text-slate-400">
            {data.params.custoPeriodo === 0
              ? `preencha CUSTO_MES_${to.slice(0, 7).replace('-', '')} em Parâmetros`
              : 'soma do custo cadastrado (Controladoria), proporcional aos dias de cada mês dentro do período filtrado'}
          </p>
          {kpis.mesAberto && (
            <div className="mt-2 space-y-0.5 border-t border-slate-100 pt-2 text-[11px] text-slate-500">
              <p>
                Mês {data.params.custoMesAtual.ym} em aberto ({data.params.custoMesAtual.diasDecorridos}/
                {data.params.custoMesAtual.diasDoMes} dias)
              </p>
              <p>
                Lançado até agora: R$ {fmt(data.params.custoMesAtual.lancado, 2)} · ritmo R${' '}
                {fmt(data.params.custoMesAtual.custoDiaBase, 2)}/dia
              </p>
              <p className="font-medium text-slate-600">
                Projeção de fechamento do mês: R$ {fmt(data.params.custoMesAtual.projetadoFechamento, 2)}
              </p>
            </div>
          )}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">Custo R$/km</p>
          <p className="mt-1 text-2xl font-semibold text-slate-700">
            {data.params.custoPeriodo > 0 ? fmt(kpis.custoPorKm, 2) : '—'}
          </p>
          {data.params.custoPeriodo === 0 && (
            <p className="text-[11px] text-slate-400">
              preencha CUSTO_MES_{to.slice(0, 7).replace('-', '')} em Parâmetros
            </p>
          )}
          {kpis.custoPorKmEstimado !== null && (
            <p className="mt-1 text-xs font-medium text-amber-700">
              Estimado (mês fechando no ritmo atual): R$ {fmt(kpis.custoPorKmEstimado, 2)}/km
            </p>
          )}
          <CalculoCustoDetalhe
            custoMesAtual={data.params.custoMesAtual}
            custoPorMes={data.params.custoPorMes}
            custoPeriodo={data.params.custoPeriodo}
            denominadorLabel="km rodado"
            denominadorValor={kpis.kmTotal}
            resultadoLabel="R$/km"
            resultadoValor={kpis.custoPorKm}
          />
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">Custo R$/tonelada</p>
          <p className="mt-1 text-2xl font-semibold text-slate-700">
            {data.params.custoPeriodo > 0 ? fmt(kpis.custoPorTonelada, 2) : '—'}
          </p>
          {data.params.custoPeriodo === 0 && (
            <p className="text-[11px] text-slate-400">
              preencha CUSTO_MES_{to.slice(0, 7).replace('-', '')} em Parâmetros
            </p>
          )}
          {kpis.custoPorToneladaEstimado !== null && (
            <p className="mt-1 text-xs font-medium text-amber-700">
              Estimado (mês fechando no ritmo atual): R$ {fmt(kpis.custoPorToneladaEstimado, 2)}/t
            </p>
          )}
          <CalculoCustoDetalhe
            custoMesAtual={data.params.custoMesAtual}
            custoPorMes={data.params.custoPorMes}
            custoPeriodo={data.params.custoPeriodo}
            denominadorLabel="toneladas transportadas"
            denominadorValor={kpis.pesoT}
            resultadoLabel="R$/tonelada"
            resultadoValor={kpis.custoPorTonelada}
          />
        </div>
      </div>

      {/* Cards com explicação (número + como é calculado) — precisam de mais espaço */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">
            Ritmo da frota (meta {fmt(data.params.metaKm)} km/mês)
          </p>
          <p
            className={`mt-1 text-2xl font-semibold ${kpis.ritmoFrota >= 100 ? 'text-emerald-700' : kpis.ritmoFrota >= 80 ? 'text-amber-600' : 'text-red-600'}`}
          >
            {fmt(kpis.ritmoFrota)}%
          </p>
          <p className="text-xs text-slate-500">
            média do ritmo de cada placa (composições com meta própria em Cadastros → Parâmetros)
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">Ocupação da frota</p>
          <p
            className={`mt-1 text-2xl font-semibold ${kpis.ocupacaoFrota >= 80 ? 'text-emerald-700' : kpis.ocupacaoFrota >= 50 ? 'text-amber-600' : 'text-red-600'}`}
          >
            {fmt(kpis.ocupacaoFrota)}%
          </p>
          <p className="text-xs text-slate-500">
            mede tempo: dias em viagem ÷ {fmt(data.params.diasDecorridos)} dias decorridos
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">Previsão de KM no fechamento</p>
          <p
            className={`mt-1 text-2xl font-semibold ${kpis.kmProjetadoPorCaminhao >= data.params.metaKm ? 'text-emerald-700' : 'text-red-600'}`}
          >
            {fmt(kpis.kmProjetadoPorCaminhao)}
          </p>
          <p className="text-xs text-slate-500">
            km/caminhão no ritmo atual (meta {fmt(data.params.metaKm)}) ·{' '}
            {fmt(kpis.kmProjetado)} km na frota
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">Previsão de viagens no fechamento</p>
          <p className="mt-1 text-2xl font-semibold text-emerald-700">{fmt(kpis.viagensProjetadas)}</p>
          <p className="text-xs text-slate-500">
            no ritmo atual · hoje: {fmt(kpis.viagens)} viagens
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">Margem R$/km (mês)</p>
          <p
            className={`mt-1 text-2xl font-semibold ${kpis.margemPorKm === null ? 'text-slate-400' : kpis.margemPorKm >= 0 ? 'text-emerald-700' : 'text-red-600'}`}
          >
            {kpis.margemPorKm === null ? '—' : `${kpis.margemPorKm >= 0 ? '+' : ''}${fmt(kpis.margemPorKm, 2)}`}
          </p>
          <p className="text-xs text-slate-500">
            {kpis.margemPorKm === null
              ? 'precisa de custo do mês (Parâmetros) e rota precificada'
              : kpis.margemPorKm >= 0
                ? 'acima do custo — receita esperada − custo, por km'
                : 'abaixo do custo — receita esperada − custo, por km'}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">Margem R$/tonelada (mês)</p>
          <p
            className={`mt-1 text-2xl font-semibold ${kpis.margemPorTonelada === null ? 'text-slate-400' : kpis.margemPorTonelada >= 0 ? 'text-emerald-700' : 'text-red-600'}`}
          >
            {kpis.margemPorTonelada === null ? '—' : `${kpis.margemPorTonelada >= 0 ? '+' : ''}${fmt(kpis.margemPorTonelada, 2)}`}
          </p>
          <p className="text-xs text-slate-500">
            {kpis.margemPorTonelada === null
              ? 'precisa de custo do mês (Parâmetros) e rota precificada'
              : kpis.margemPorTonelada >= 0
                ? 'acima do custo — receita esperada − custo, por tonelada'
                : 'abaixo do custo — receita esperada − custo, por tonelada'}
          </p>
        </div>
      </div>

      {/* Desvio de performance por manutenção — não exclui o caminhão da meta, só explica o resultado */}
      {manutencaoKpis.diasTotal > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-sm text-slate-500">Dias em manutenção (frota, no período)</p>
            <p className="mt-1 text-2xl font-semibold text-slate-700">{fmt(manutencaoKpis.diasTotal)}</p>
            <p className="text-xs text-slate-500">
              {fmt(manutencaoKpis.placas)} placa(s) — ver Cadastros → Manutenção
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-sm text-slate-500">KM esperado perdido (manutenção)</p>
            <p className="mt-1 text-2xl font-semibold text-amber-600">{fmt(manutencaoKpis.kmPerdido)}</p>
            <p className="text-xs text-slate-500">
              estimativa: dias parados × ritmo médio esperado por dia — quanto da meta a manutenção explica
            </p>
          </div>
        </div>
      )}

      {/* Quadro de status (última viagem de cada placa/motorista, conforme a aba) */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {(Object.keys(STATUS_STYLE) as TruckStatus[]).map((st) => {
          const count = activeGroups.filter((t) => t.status === st).length
          const info = STATUS_STYLE[st]
          // "=" força igualdade exata — sem isso "Atrasado" casaria com
          // "Muito atrasado" no filtro por "contém"
          const isFiltered = (colFilters.status ?? '') === `=${info.label}`
          return (
            <button
              key={st}
              onClick={() =>
                setColFilters((prev) => ({
                  ...prev,
                  status: isFiltered ? '' : `=${info.label}`,
                }))
              }
              className={`rounded-xl border p-3 text-left ${isFiltered ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}
              title="Clique para filtrar a tabela por este status"
            >
              <span className={`rounded px-2 py-0.5 text-xs ${info.cls}`}>{info.label}</span>
              <p className="mt-1 text-2xl font-semibold">{count}</p>
              <p className="text-xs text-slate-500">
                {aba === 'motorista' ? 'motorista(s)' : 'equipamento(s)'} — {info.desc}
              </p>
            </button>
          )
        })}
      </div>

      {/* Gráficos na parte superior (padrão: tabela fica embaixo) */}
      <div id="secao-graficos" />
      <MonthlyPerformanceChart
        data={monthlyComparison}
        title="Performance vs meses anteriores — KM médio por placa"
        subtitle={`Segue os filtros do painel · do dia 1º ao dia ${data.params.cutoffDay} de cada mês (D-1) · média por placa evita distorção quando o nº de caminhões varia · ◆ = tendência do mês atual no fechamento`}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <FreightPieChart
          data={countBy(periodTrips.filter((t) => matchesDims(t, 'frete')), DIMENSIONS.frete)}
          title="Frete próprio × terceiro (viagens)"
          selected={filters.frete}
          onSelect={(name, additive) => toggleFilter('frete', name, additive)}
        />
        <TripsBarChart
          data={countBy(periodTrips.filter((t) => matchesDims(t, 'tipoProduto')), DIMENSIONS.tipoProduto)}
          title="Viagens por tipo de produto"
          selected={filters.tipoProduto}
          onSelect={(name, additive) => toggleFilter('tipoProduto', name, additive)}
        />
        <TripsBarChart
          data={countBy(periodTrips.filter((t) => matchesDims(t, 'upc')), DIMENSIONS.upc)}
          title="Viagens por Origem"
          selected={filters.upc}
          onSelect={(name, additive) => toggleFilter('upc', name, additive)}
        />
      </div>

      {/* Viagens por dia da semana + % de ciclos que atrasaram (sugestão do usuário) */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-medium">
          Viagens por dia da semana
          <span className="ml-2 text-sm font-normal text-slate-500">
            % = ciclos cujo intervalo até a próxima saída passou da duração esperada da viagem
          </span>
        </h2>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-7">
          {weekdayData.map((d) => (
            <button
              key={d.dia}
              type="button"
              onClick={() => setDiaExplicado(diaExplicado === d.dia ? null : d.dia)}
              className="rounded-lg border border-slate-100 p-2 text-center hover:bg-slate-50"
              title="Clique para entender este número"
            >
              <p className="text-xs text-slate-500">{d.dia}</p>
              <p className="text-lg font-semibold">{d.viagens}</p>
              <p
                className={`text-xs ${d.atrasoPct >= 40 ? 'text-red-600' : d.atrasoPct >= 20 ? 'text-amber-600' : 'text-slate-500'}`}
              >
                {d.atrasoPct}% atraso
              </p>
            </button>
          ))}
        </div>
        {diaExplicado &&
          (() => {
            const d = weekdayData.find((w) => w.dia === diaExplicado)
            if (!d) return null
            return (
              <div className="mt-2 rounded-md bg-slate-50 p-2 text-xs leading-relaxed text-slate-600">
                <strong>{d.dia}:</strong> {d.viagens} viagem(ns) com saída nesse dia da semana no período. Dessas,{' '}
                {d.ciclos} formaram um “ciclo” avaliável (tinham uma próxima viagem da mesma placa depois, com
                duração esperada calculada — a última viagem de cada placa não entra, porque não tem próxima saída
                pra comparar). De {d.ciclos} ciclo(s), {d.atrasados} atrasaram (o intervalo real até a próxima saída
                foi maior que a duração esperada da viagem — ida + carga/descarga + volta).{' '}
                {d.ciclos > 0 ? (
                  <>
                    {d.atrasados} ÷ {d.ciclos} = {d.atrasoPct}%.
                  </>
                ) : (
                  'Sem ciclo avaliável ainda para este dia — precisa de pelo menos 2 viagens da mesma placa no período.'
                )}
              </div>
            )
          })()}
      </div>

      {/* Abas: Por Placa / Por Motorista (espelhadas) + Acompanhamento e
          Atrasados justificados (estrutura própria, não espelhada).
          "Painel estratégico" movido para logo após a principal (pedido do
          usuário 2026-08-13: "trazer a aba do estratégico para o topo assim
          como é na madeira tratada" — mesma posição de destaque que tem em
          Fase3, logo depois da aba de análise por período; as demais abas
          seguem depois, sem mudar qual carrega por padrão). */}
      {manutencaoErro && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">
          {manutencaoErro}
        </div>
      )}

      <div id="secao-tabela" className="flex flex-wrap gap-2 border-b border-slate-200">
        {(['placa', 'estrategico', 'disponibilidade', 'motorista', 'board', 'atrasados', 'combustivel', 'critica'] as Aba[]).map((a) => (
          <button
            key={a}
            onClick={() => setAba(a)}
            className={`-mb-px rounded-t-md border border-b-0 px-4 py-2 text-sm font-medium transition-colors ${aba === a ? 'border-slate-200 bg-emerald-700 text-white shadow-sm' : 'border-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-700'}`}
          >
            {a === 'placa'
              ? 'Por Placa'
              : a === 'motorista'
                ? 'Por Motorista'
                : a === 'board'
                  ? 'Acompanhamento'
                  : a === 'atrasados'
                    ? 'Atrasados justificados'
                    : a === 'combustivel'
                      ? 'Combustível'
                      : a === 'critica'
                        ? 'Crítica ao modelo'
                        : a === 'disponibilidade'
                          ? 'Disponibilidade & Eficiência'
                          : 'Painel estratégico (ano)'}
          </button>
        ))}
      </div>

      {aba === 'board' ? (
        /* Acompanhamento simples: um ícone por caminhão, cor pelo status,
           destino e ícone do produto (pedido do usuário em 2026-07-25) */
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="font-medium">
            Acompanhamento
            <span className="ml-2 text-sm font-normal text-slate-500">
              clique para filtrar · cor = status do caminhão
            </span>
          </h2>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {placaGroupsFull.map((tr) => {
              const st = STATUS_STYLE[tr.status]
              const emManutencaoTr = !!manutencaoPorPlaca.get(tr.key)?.aberta
              const last = tr.trips[0]
              const destino = String(last?.NOMEFANTASIA ?? '—')
              const produto = String(last?.TipoProduto ?? '—')
              const isSelected = filters.placa.includes(tr.key)
              const anySelected = filters.placa.length > 0
              const consumoTr = consumoPorPlaca.get(tr.key)
              return (
                <button
                  key={tr.key}
                  onClick={(e) => {
                    // Clique normal abre o detalhamento da viagem atual (pedido do
                    // usuário 2026-08-03); Ctrl+clique mantém o filtro cruzado, já
                    // usado no resto do painel para comparar com os KPIs do topo.
                    if (e.ctrlKey) {
                      toggleFilter('placa', tr.key, true)
                      return
                    }
                    setDetalheModal({
                      truck: tr,
                      otherFieldLabel: 'Motorista',
                      otherFieldKey: 'MOTORISTA',
                      ausencia: manutencaoPorPlaca.get(tr.key),
                      ausenciaLabel: 'manutenção',
                      justificativa: justificativas.get(tr.ultimaViagemKey),
                      consumo: consumoPorPlaca.get(tr.key),
                    })
                  }}
                  title={`${tr.key} · ${emManutencaoTr ? 'Em manutenção' : st.label} · ${destino}${consumoTr?.kmPorLitro != null ? ` · ${fmt(consumoTr.kmPorLitro, 2)} km/l` : ''} · clique para ver a viagem atual, Ctrl+clique para filtrar`}
                  className={`rounded-xl border p-3 text-left ${emManutencaoTr ? 'border-violet-300 bg-violet-100 text-violet-800' : st.cls} ${anySelected && !isSelected ? 'opacity-30' : ''} ${isSelected ? 'ring-2 ring-emerald-600' : ''}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-2xl">🚚</span>
                    <span className="text-xl" title={produto}>{produtoIcone(produto)}</span>
                  </div>
                  <p className="mt-1 truncate font-mono text-sm font-semibold">{tr.key}</p>
                  <p className="truncate text-xs">{destino}</p>
                  <p className="text-[11px] opacity-80">{emManutencaoTr ? '🔧 Em manutenção' : st.label}</p>
                  {consumoTr?.kmPorLitro != null && (
                    <p
                      className={`text-[11px] font-semibold ${consumoTr.kmPorLitro < data.params.metaConsumoKmL ? 'text-red-700' : 'opacity-80'}`}
                    >
                      ⛽ {fmt(consumoTr.kmPorLitro, 2)} km/l
                      {consumoTr.temAlerta && ' ⚠️'}
                    </p>
                  )}
                </button>
              )
            })}
            {placaGroupsFull.length === 0 && (
              <p className="col-span-full py-8 text-center text-sm text-slate-500">
                Nenhum caminhão no período/filtros selecionados.
              </p>
            )}
          </div>
        </div>
      ) : aba === 'atrasados' ? (
        /* Atrasados justificados: revisão do que já foi explicado, com a
           nova previsão dada (se houver) — pedido do usuário 2026-07-29 */
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-3">
            <span className="font-medium">Atrasados justificados ({atrasadosJustificados.length})</span>
            <span className="ml-2 text-sm text-slate-500">
              placas atrasadas/muito atrasadas cuja última viagem já tem justificativa registrada
            </span>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-3 py-2">Placa</th>
                <th className="px-3 py-2">Motorista</th>
                <th className="px-3 py-2 text-right">Dias de atraso</th>
                <th className="px-3 py-2">Motivo</th>
                <th className="px-3 py-2">Nova previsão</th>
                <th className="px-3 py-2">Situação</th>
              </tr>
            </thead>
            <tbody>
              {atrasadosJustificados.map(({ group, justificativa }) => {
                const previsaoMs = justificativa.novaPrevisao
                  ? new Date(`${justificativa.novaPrevisao.slice(0, 10)}T23:59:59`).getTime()
                  : null
                const vencida = previsaoMs !== null && referenceNow > previsaoMs
                return (
                  <tr key={group.ultimaViagemKey} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-mono font-medium">{group.key}</td>
                    <td className="px-3 py-2">{String(group.trips[0]?.MOTORISTA ?? '—')}</td>
                    <td className="px-3 py-2 text-right">{fmt(group.statusDays, 1)}</td>
                    <td className="px-3 py-2">{justificativa.motivo}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {justificativa.novaPrevisao ? fmtDate(justificativa.novaPrevisao) : '—'}
                    </td>
                    <td className="px-3 py-2">
                      {previsaoMs === null ? (
                        <span className="text-slate-400">sem previsão</span>
                      ) : vencida ? (
                        <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                          vencida
                        </span>
                      ) : (
                        <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                          dentro do prazo
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
              {atrasadosJustificados.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">
                    Nenhuma placa atrasada com justificativa registrada no momento.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : aba === 'combustivel' ? (
        /* Combustível: visão dedicada de consumo por placa (hodômetro
           Officium) — pedido do usuário 2026-07-29, além do card/coluna no
           resumo. Diesel e Arla em sub-abas separadas (pedido do usuário
           2026-08-14: "crie duas abas no mesmo local e detalhamento
           separando DIESEL e ARLA") — mesma fonte de dados (consumoPlacas),
           cada aba só troca as colunas mostradas pro que faz sentido pra
           aquele combustível. Arla tem seu próprio alerta (pedido do usuário
           2026-08-14: medir como % do diesel consumido, não km/l nem L/km —
           padrão de mercado 3%-5%; muito abaixo disso é indício de
           adulteração/remoção do sistema de redução de emissões). */
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
            <div>
              <span className="font-medium">Consumo de combustível ({consumoPlacas.length})</span>
              <span className="ml-2 text-sm text-slate-500">
                {combustivelSubTab === 'diesel'
                  ? `km/l pelo hodômetro (Officium) — meta ${fmt(data.params.metaConsumoKmL, 2)} km/l`
                  : 'Arla32 (% do Diesel consumido) — padrão de mercado 3%-5%'}{' '}
                · clique na placa em “Por Placa” para o detalhe completo
              </span>
            </div>
            {combustivelSubTab === 'diesel' && (
              <span
                className={`rounded-full px-3 py-1 text-sm font-medium ${consumoFrota.abaixoDaMeta > 0 ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-800'}`}
              >
                {consumoFrota.abaixoDaMeta} placa(s) abaixo da meta
              </span>
            )}
          </div>
          <div className="flex gap-1 border-b border-slate-100 px-4 pt-2">
            {(['diesel', 'arla'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setCombustivelSubTab(t)}
                className={`-mb-px rounded-t-md border border-b-0 px-3 py-1.5 text-sm font-medium transition-colors ${
                  combustivelSubTab === t
                    ? 'border-slate-200 bg-emerald-700 text-white'
                    : 'border-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-700'
                }`}
              >
                {t === 'diesel' ? 'Diesel' : 'Arla32'}
              </button>
            ))}
          </div>
          {combustivelSubTab === 'diesel' ? (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2"></th>
                  <th className="px-3 py-2">Placa</th>
                  <th className="px-3 py-2">Produto</th>
                  <th className="px-3 py-2 text-right">Abastecimentos</th>
                  <th className="px-3 py-2 text-right">Litros diesel</th>
                  <th className="px-3 py-2 text-right">KM (hodômetro)</th>
                  <th className="px-3 py-2 text-right">km/l</th>
                  <th className="px-3 py-2">Situação</th>
                  <th
                    className="px-3 py-2 text-right"
                    title="% dos abastecimentos do período com consumo fora do padrão — crítico = 3+ ocorrências ou metade+ dos abastecimentos (padrão recorrente, possível sensor quebrado ou fraude)"
                  >
                    Anormalidade
                  </th>
                </tr>
              </thead>
              <tbody>
                {consumoPlacas.map((c) => (
                  <tr
                    key={c.placa}
                    onClick={(e) => {
                      const truckMatch = placaGroupsFull.find((g) => g.key === c.placa)
                      if (truckMatch) {
                        setDetalheModal({
                          truck: truckMatch,
                          otherFieldLabel: 'Motorista',
                          otherFieldKey: 'MOTORISTA',
                          ausencia: manutencaoPorPlaca.get(c.placa),
                          ausenciaLabel: 'manutenção',
                          justificativa: justificativas.get(truckMatch.ultimaViagemKey),
                          consumo: c,
                        })
                      } else {
                        toggleFilter('placa', c.placa, e.ctrlKey)
                      }
                    }}
                    className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                    title="Ver detalhamento completo"
                  >
                    <td className="px-3 py-2">{c.temAlerta && '⚠️'}</td>
                    <td className="px-3 py-2 font-mono font-medium">{c.placa}</td>
                    <td className="px-3 py-2 text-xs text-slate-600">{c.produtos || '—'}</td>
                    <td className="px-3 py-2 text-right">{c.abastecimentos}</td>
                    <td className="px-3 py-2 text-right">{fmt(c.litrosConsiderados, 1)}</td>
                    <td className="px-3 py-2 text-right">{fmt(c.kmRodado)}</td>
                    <td className="px-3 py-2 text-right">
                      {c.kmPorLitro === null ? '—' : fmt(c.kmPorLitro, 2)}
                    </td>
                    <td className="px-3 py-2">
                      {c.kmPorLitro === null ? (
                        <span className="text-slate-400">sem dados</span>
                      ) : c.kmPorLitro >= data.params.metaConsumoKmL ? (
                        <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                          dentro da meta
                        </span>
                      ) : (
                        <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                          abaixo da meta
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {c.alertasCount === 0 ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        <span
                          className={`rounded px-2 py-0.5 text-xs font-medium ${c.nivelAnormalidade === 'critico' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}`}
                          title={`${c.alertasCount} de ${c.totalIntervalos} abastecimento(s) com alerta`}
                        >
                          {c.scoreAnormalidade}% {c.nivelAnormalidade === 'critico' ? 'crítico' : 'atenção'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {consumoPlacas.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-sm text-slate-500">
                      Nenhum abastecimento encontrado para a frota própria no período.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2">Placa</th>
                  <th className="px-3 py-2 text-right">Litros de Arla</th>
                  <th
                    className="px-3 py-2 text-right"
                    title="Litros de Arla32 no período ÷ litros de Diesel no período × 100 — padrão de mercado é 3% a 5%"
                  >
                    Arla (% do Diesel)
                  </th>
                  <th className="px-3 py-2 text-right" title="Litros de Arla32 no período ÷ km rodado (hodômetro) — dado de referência">
                    L/km (ref.)
                  </th>
                  <th className="px-3 py-2">Origem</th>
                </tr>
              </thead>
              <tbody>
                {[...consumoPlacas]
                  .filter((c) => c.litrosArla > 0 || c.arlaPctDiesel !== null)
                  .sort((a, b) => {
                    const aAlerta = a.arlaAlerta !== null ? 1 : 0
                    const bAlerta = b.arlaAlerta !== null ? 1 : 0
                    if (aAlerta !== bAlerta) return bAlerta - aAlerta
                    return b.litrosArla - a.litrosArla
                  })
                  .map((c) => (
                    <tr
                      key={c.placa}
                      onClick={(e) => {
                        const truckMatch = placaGroupsFull.find((g) => g.key === c.placa)
                        if (truckMatch) {
                          setDetalheModal({
                            truck: truckMatch,
                            otherFieldLabel: 'Motorista',
                            otherFieldKey: 'MOTORISTA',
                            ausencia: manutencaoPorPlaca.get(c.placa),
                            ausenciaLabel: 'manutenção',
                            justificativa: justificativas.get(truckMatch.ultimaViagemKey),
                            consumo: c,
                          })
                        } else {
                          toggleFilter('placa', c.placa, e.ctrlKey)
                        }
                      }}
                      className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${c.arlaAlerta ? 'bg-red-50' : ''}`}
                      title={c.arlaAlerta ?? 'Ver detalhamento completo'}
                    >
                      <td className="px-3 py-2 font-mono font-medium">{c.placa}</td>
                      <td className="px-3 py-2 text-right">{fmt(c.litrosArla, 1)}</td>
                      <td className={`px-3 py-2 text-right ${c.arlaAlerta ? 'font-semibold text-red-700' : ''}`}>
                        {c.arlaPctDiesel === null ? '—' : `${fmt(c.arlaPctDiesel, 1)}%`}
                        {c.arlaAlerta && ' ⚠️'}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-500">
                        {c.arlaPorKm === null ? '—' : fmt(c.arlaPorKm, 3)}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {c.arlaPctDieselEstimado ? (
                          <span
                            className="rounded bg-amber-100 px-2 py-0.5 text-amber-800"
                            title={c.arlaPorKmReferenciaEm ? `Sem diesel no período — ref. ${fmtDateBR(c.arlaPorKmReferenciaEm.slice(0, 10))}` : 'Sem diesel no período'}
                          >
                            estimado (histórico)
                          </span>
                        ) : (
                          <span className="text-slate-400">período</span>
                        )}
                      </td>
                    </tr>
                  ))}
                {consumoPlacas.filter((c) => c.litrosArla > 0 || c.arlaPctDiesel !== null).length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">
                      Nenhum abastecimento de Arla32 encontrado para a frota própria no período.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      ) : aba === 'critica' ? (
        <CriticaModeloTab />
      ) : aba === 'estrategico' ? (
        <Fase1Estrategico trips={data?.trips ?? []} custoMesRegistrado={data?.params.custoMesRegistrado ?? {}} />
      ) : aba === 'disponibilidade' ? (
        <Fase1Disponibilidade
          trips={data?.trips ?? []}
          manutencoes={data?.manutencoes ?? []}
          from={from}
          to={to}
          metaKm={data?.params.metaKm ?? 8000}
          metaKmPorComposicao={data?.params.metaKmPorComposicao ?? {}}
        />
      ) : (
        <>
      {/* Tabela principal: agrupada por placa ou motorista, conforme a aba */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white print:overflow-visible">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 print:hidden">
          <div>
            <span className="font-medium">{aba === 'placa' ? 'Caminhões' : 'Motoristas'}</span>
            <span className="ml-2 text-sm text-slate-500">
              clique na linha para filtrar · seta para ver as viagens
              {aba === 'motorista' && (
                <span
                  className="ml-1"
                  title='Consumo (km/l) por motorista: cada abastecimento é atribuído ao motorista da nota fiscal mais recente da mesma placa até aquela data (emitiu nota hoje, todo abastecimento até aparecer nota de outro motorista é dele). A Officium não registra motorista no abastecimento, só placa — por isso a atribuição usa a data da nota; sem nota anterior conhecida da placa, o abastecimento fica sem motorista.'
                >
                  · consumo atribuído pela data da nota fiscal ⓘ
                </span>
              )}
            </span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={exportCsv}
              className="rounded-md border border-slate-300 px-3 py-1 text-xs hover:bg-slate-50"
            >
              Exportar CSV
            </button>
            <button
              onClick={() => window.print()}
              className="rounded-md border border-slate-300 px-3 py-1 text-xs hover:bg-slate-50"
            >
              Imprimir
            </button>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              <th className="w-8 px-2 py-2"></th>
              {columns.map((c) => (
                <th
                  key={c.key}
                  onClick={() => toggleSort(c.key)}
                  className={`cursor-pointer select-none px-3 py-2 hover:text-emerald-700 ${c.align === 'right' ? 'text-right' : ''}`}
                  title="Clique para ordenar"
                >
                  {c.label}
                  {sort.key === c.key && (
                    <span className="ml-1 text-emerald-700">{sort.dir === 'asc' ? '▲' : '▼'}</span>
                  )}
                </th>
              ))}
            </tr>
            <tr className="border-t border-slate-100">
              <td className="px-2 py-1"></td>
              {columns.map((c) => (
                <td key={c.key} className="px-2 py-1">
                  <input
                    value={colFilters[c.key] ?? ''}
                    onChange={(e) =>
                      setColFilters((prev) => ({ ...prev, [c.key]: e.target.value }))
                    }
                    placeholder={c.numeric ? 'ex.: >5000' : 'filtrar…'}
                    className="w-full rounded border border-slate-200 px-1.5 py-0.5 text-xs font-normal focus:border-emerald-500 focus:outline-none"
                  />
                </td>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleGroups.map((tr) => {
              const expandKey = `${aba}:${tr.key}`
              const isExpanded = expanded.has(expandKey)
              const isSelected = filters[activeDim].includes(tr.key)
              return (
                <FragmentRow
                  key={tr.key}
                  truck={tr}
                  otherFieldLabel={aba === 'placa' ? 'Motorista' : 'Placa'}
                  otherFieldKey={aba === 'placa' ? 'MOTORISTA' : 'PLACA'}
                  ausencia={aba === 'motorista' ? feriasPorMotorista.get(tr.key) : manutencaoPorPlaca.get(tr.key)}
                  ausenciaLabel={aba === 'motorista' ? 'férias' : 'manutenção'}
                  justificativa={justificativas.get(tr.ultimaViagemKey)}
                  onJustificar={saveJustificativa}
                  consumoDisplay={aba === 'placa' ? consumoPorPlaca.get(tr.key) : consumoPorMotorista.get(tr.key)}
                  metaConsumoKmL={data.params.metaConsumoKmL}
                  onDetalhar={() =>
                    setDetalheModal({
                      truck: tr,
                      otherFieldLabel: aba === 'placa' ? 'Motorista' : 'Placa',
                      otherFieldKey: aba === 'placa' ? 'MOTORISTA' : 'PLACA',
                      ausencia: aba === 'motorista' ? feriasPorMotorista.get(tr.key) : manutencaoPorPlaca.get(tr.key),
                      ausenciaLabel: aba === 'motorista' ? 'férias' : 'manutenção',
                      justificativa: justificativas.get(tr.ultimaViagemKey),
                      consumo: aba === 'placa' ? consumoPorPlaca.get(tr.key) : undefined,
                    })
                  }
                  isExpanded={isExpanded}
                  isSelected={isSelected}
                  anySelected={filters[activeDim].length > 0}
                  onToggleExpand={() =>
                    setExpanded((prev) => {
                      const next = new Set(prev)
                      if (next.has(expandKey)) next.delete(expandKey)
                      else next.add(expandKey)
                      return next
                    })
                  }
                  onSelect={(additive) => toggleFilter(activeDim, tr.key, additive)}
                  onToggleManutencao={aba === 'placa' ? (previsao) => toggleManutencao(tr.key, previsao) : undefined}
                />
              )
            })}
            {visibleGroups.length === 0 && (
              <tr>
                <td colSpan={12} className="px-4 py-8 text-center text-slate-500">
                  {aba === 'placa'
                    ? 'Nenhum caminhão no período/filtros selecionados.'
                    : 'Nenhum motorista no período/filtros selecionados.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Quadro acumulado: ritmo de todas as placas ou motoristas, conforme a aba */}
      <div id="secao-ritmo" className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-medium">
          Ritmo acumulado por {aba === 'placa' ? 'placa' : 'motorista'}
          <span className="ml-2 text-sm font-normal text-slate-500">
            barra = KM rodado vs. esperado até hoje ({fmt(data.params.ritmoKm)} km)
          </span>
        </h2>
        <div className="mt-3 grid grid-cols-1 gap-y-2">
          {activeGroups.map((tr) => (
            <button
              key={tr.key}
              onClick={(e) => toggleFilter(activeDim, tr.key, e.ctrlKey)}
              className={`flex items-center gap-2 text-left ${filters[activeDim].length > 0 && !filters[activeDim].includes(tr.key) ? 'opacity-40' : ''}`}
            >
              <span className="w-28 shrink-0 truncate font-mono text-xs">{tr.key}</span>
              <div className="h-4 flex-1 overflow-hidden rounded bg-slate-100">
                <div
                  className={`h-full ${tr.ritmoPct >= 100 ? 'bg-emerald-600' : tr.ritmoPct >= 80 ? 'bg-amber-500' : 'bg-red-500'}`}
                  style={{ width: `${Math.min(100, tr.ritmoPct)}%` }}
                />
              </div>
              <span className="w-28 shrink-0 text-right text-xs text-slate-600">
                {fmt(tr.kmAcumulado)} km · {fmt(tr.ritmoPct)}%
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* "Sumidos": tinham viagem nos últimos 30 dias mas nenhuma no período selecionado */}
      {sumidos.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          <h2 className="font-medium text-amber-900">
            Motoristas sem viagem no período ({sumidos.length})
            <span className="ml-2 text-sm font-normal text-amber-800">
              tiveram viagem nos últimos 30 dias, mas nenhuma no período selecionado — pode indicar
              motorista afastado
            </span>
          </h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {sumidos.map((s) => (
              <span key={s.key} className="rounded-full bg-white px-3 py-1 text-xs text-amber-900">
                <span className="font-mono font-medium">{s.key}</span> — última viagem {fmtDate(s.lastDate)}
              </span>
            ))}
          </div>
        </div>
      )}
        </>
      )}

      {/* Conformidade de peso: viagens acima do limite de carga líquida da composição */}
      <div id="secao-conformidade" className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-medium">
            Conformidade de peso
            <span className="ml-2 text-sm font-normal text-slate-500">
              peso líquido acima do limite cadastrado por composição (2+ notas na mesma viagem
              contam sempre como RodoTrem)
            </span>
          </h2>
          <span
            className={`rounded-full px-3 py-1 text-sm font-medium ${overweightTrips.length > 0 ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-800'}`}
          >
            {overweightTrips.length} viagem(ns) fora do limite
          </span>
        </div>
        {overweightTrips.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500">
                <tr>
                  <th className="w-8 px-2 py-1"></th>
                  <th className="px-2 py-1">Saída</th>
                  <th className="px-2 py-1">Placa</th>
                  <th className="px-2 py-1">Composição</th>
                  <th className="px-2 py-1">Nota(s) fiscal(is)</th>
                  <th className="px-2 py-1 text-right">Peso líq. (t)</th>
                  <th className="px-2 py-1 text-right">Limite (t)</th>
                  <th className="px-2 py-1 text-right">Excesso (t)</th>
                </tr>
              </thead>
              <tbody>
                {overweightTrips.map((t, i) => {
                  const key = `${t.DATASAIDA}|${t.PLACA}|${t.NOMEFANTASIA}|${i}`
                  const isOpen = expandedCompliance.has(key)
                  const notas = Array.isArray(t.NOTAS) ? (t.NOTAS as Trip[]) : []
                  return (
                    <Fragment key={key}>
                      <tr className="border-t border-slate-100">
                        <td className="px-2 py-1">
                          <button
                            onClick={() =>
                              setExpandedCompliance((prev) => {
                                const next = new Set(prev)
                                if (next.has(key)) next.delete(key)
                                else next.add(key)
                                return next
                              })
                            }
                            className="rounded px-1 text-slate-500 hover:bg-slate-200"
                            title="Ver notas fiscais da viagem"
                          >
                            {isOpen ? '▾' : '▸'}
                          </button>
                        </td>
                        <td className="px-2 py-1 whitespace-nowrap">{fmtDate(String(t.DATASAIDA ?? ''))}</td>
                        <td className="px-2 py-1 font-mono">{String(t.PLACA ?? '—')}</td>
                        <td className="px-2 py-1">{String(t['TipoComposição'] ?? '—')}</td>
                        <td className="px-2 py-1 font-mono text-xs">{String(t.NUMEROMOV ?? '—')}</td>
                        <td className="px-2 py-1 text-right">{fmt(Number(t.PESOLIQUIDO ?? 0) / 1000, 1)}</td>
                        <td className="px-2 py-1 text-right">{fmt(Number(t.PESO_LIMITE_T ?? 0), 1)}</td>
                        <td className="px-2 py-1 text-right font-medium text-red-600">
                          +{fmt(Number(t.PESO_EXCESSO_T ?? 0), 1)}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="border-t border-slate-100 bg-slate-50">
                          <td></td>
                          <td colSpan={7} className="px-2 py-2">
                            <table className="w-full text-xs">
                              <thead className="text-left text-slate-500">
                                <tr>
                                  <th className="px-2 py-1">Nota fiscal</th>
                                  <th className="px-2 py-1">Origem</th>
                                  <th className="px-2 py-1">Cliente</th>
                                  <th className="px-2 py-1">Produto</th>
                                  <th className="px-2 py-1 text-right">Peso bruto (t)</th>
                                  <th className="px-2 py-1 text-right">Peso líquido (t)</th>
                                </tr>
                              </thead>
                              <tbody>
                                {notas.map((n, ni) => (
                                  <tr key={ni} className="border-t border-slate-200">
                                    <td className="px-2 py-1 font-mono">{String(n.numeroMov ?? '—')}</td>
                                    <td className="px-2 py-1">{String(n.origem ?? '—')}</td>
                                    <td className="px-2 py-1">{String(n.cliente ?? '—')}</td>
                                    <td className="px-2 py-1">{String(n.produto ?? '—')}</td>
                                    <td className="px-2 py-1 text-right">
                                      {fmt(Number(n.pesoBruto ?? 0) / 1000, 2)}
                                    </td>
                                    <td className="px-2 py-1 text-right">
                                      {fmt(Number(n.pesoLiquido ?? 0) / 1000, 2)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Inconsistência de composição: três motivos possíveis, ver
          src/lib/fase1/composition.ts (applyCompositionOverrides) para a
          lógica exata. O texto abaixo e a coluna "Motivo" da tabela
          precisam continuar batendo com essas três condições — usuário
          reportou 2026-08-05 que não conseguia identificar o motivo de cada
          linha porque o texto só descrevia as duas primeiras condições (a
           terceira foi adicionada depois, em 2026-08-03, e o texto não foi
          atualizado). */}
      <div id="secao-inconsistencias" className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-medium">
            Inconsistências de composição
            <span className="ml-2 text-sm font-normal text-slate-500">
              3+ notas fiscais no mesmo dia (nem RodoTrem justifica, só tem 2 reboques) OU 2
              notas numa placa que não é cadastrada como RodoTrem OU 1 nota só numa placa
              cadastrada como RodoTrem (que deveria sempre emitir 2) — confira o motivo de cada
              linha na coluna "Motivo"
            </span>
          </h2>
          <span
            className={`rounded-full px-3 py-1 text-sm font-medium ${inconsistentTrips.length > 0 ? 'bg-orange-100 text-orange-800' : 'bg-emerald-100 text-emerald-800'}`}
          >
            {inconsistentTrips.length} viagem(ns) inconsistente(s)
          </span>
        </div>
        {inconsistentTrips.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500">
                <tr>
                  <th className="w-8 px-2 py-1"></th>
                  <th className="px-2 py-1">Saída</th>
                  <th className="px-2 py-1">Placa</th>
                  <th className="px-2 py-1">Motorista</th>
                  <th className="px-2 py-1">Composição cadastrada</th>
                  <th className="px-2 py-1">Nota(s) fiscal(is)</th>
                  <th className="px-2 py-1 text-right">Peso líq. (t)</th>
                  <th className="px-2 py-1">Motivo</th>
                </tr>
              </thead>
              <tbody>
                {inconsistentTrips.map((t, i) => {
                  const key = `inc:${t.DATASAIDA}|${t.PLACA}|${t.NOMEFANTASIA}|${i}`
                  const isOpen = expandedCompliance.has(key)
                  const notas = Array.isArray(t.NOTAS) ? (t.NOTAS as Trip[]) : []
                  // Mesmas três condições de `applyCompositionOverrides`
                  // (src/lib/fase1/composition.ts) — precisa ficar em sincronia
                  // com a lógica de lá se as regras mudarem.
                  const numMovimentos = Number(t.MOVIMENTOS ?? 1)
                  const cadastrada = t.COMPOSICAO_CADASTRADA ? String(t.COMPOSICAO_CADASTRADA) : null
                  const motivo =
                    numMovimentos >= 3
                      ? `${numMovimentos} notas no mesmo agrupamento (RodoTrem só tem 2 reboques)`
                      : numMovimentos >= 2
                        ? `2 notas, mas cadastro diz "${cadastrada}" (não RodoTrem)`
                        : `1 nota só, mas cadastro diz RodoTrem (deveria ter 2)`
                  return (
                    <Fragment key={key}>
                      <tr className="border-t border-slate-100">
                        <td className="px-2 py-1">
                          <button
                            onClick={() =>
                              setExpandedCompliance((prev) => {
                                const next = new Set(prev)
                                if (next.has(key)) next.delete(key)
                                else next.add(key)
                                return next
                              })
                            }
                            className="rounded px-1 text-slate-500 hover:bg-slate-200"
                            title="Ver notas fiscais da viagem"
                          >
                            {isOpen ? '▾' : '▸'}
                          </button>
                        </td>
                        <td className="px-2 py-1 whitespace-nowrap">{fmtDate(String(t.DATASAIDA ?? ''))}</td>
                        <td className="px-2 py-1 font-mono">{String(t.PLACA ?? '—')}</td>
                        <td className="px-2 py-1">{String(t.MOTORISTA ?? '—')}</td>
                        <td className="px-2 py-1">{String(t.COMPOSICAO_CADASTRADA ?? '—')}</td>
                        <td className="px-2 py-1 font-mono text-xs">{String(t.NUMEROMOV ?? '—')}</td>
                        <td className="px-2 py-1 text-right">{fmt(Number(t.PESOLIQUIDO ?? 0) / 1000, 1)}</td>
                        <td className="px-2 py-1 text-xs text-slate-600">{motivo}</td>
                      </tr>
                      {isOpen && (
                        <tr className="border-t border-slate-100 bg-slate-50">
                          <td></td>
                          <td colSpan={7} className="px-2 py-2">
                            <table className="w-full text-xs">
                              <thead className="text-left text-slate-500">
                                <tr>
                                  <th className="px-2 py-1">Nota fiscal</th>
                                  <th className="px-2 py-1">Origem</th>
                                  <th className="px-2 py-1">Cliente</th>
                                  <th className="px-2 py-1">Produto</th>
                                  <th className="px-2 py-1 text-right">Peso bruto (t)</th>
                                  <th className="px-2 py-1 text-right">Peso líquido (t)</th>
                                </tr>
                              </thead>
                              <tbody>
                                {notas.map((n, ni) => (
                                  <tr key={ni} className="border-t border-slate-200">
                                    <td className="px-2 py-1 font-mono">{String(n.numeroMov ?? '—')}</td>
                                    <td className="px-2 py-1">{String(n.origem ?? '—')}</td>
                                    <td className="px-2 py-1">{String(n.cliente ?? '—')}</td>
                                    <td className="px-2 py-1">{String(n.produto ?? '—')}</td>
                                    <td className="px-2 py-1 text-right">
                                      {fmt(Number(n.pesoBruto ?? 0) / 1000, 2)}
                                    </td>
                                    <td className="px-2 py-1 text-right">
                                      {fmt(Number(n.pesoLiquido ?? 0) / 1000, 2)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {detalheModal && <PlacaDetailModal {...detalheModal} onClose={() => setDetalheModal(null)} />}
    </div>
  )
}

function FragmentRow({
  truck,
  otherFieldLabel,
  otherFieldKey,
  ausencia,
  ausenciaLabel,
  justificativa,
  onJustificar,
  consumoDisplay,
  metaConsumoKmL,
  onDetalhar,
  isExpanded,
  isSelected,
  anySelected,
  onToggleExpand,
  onSelect,
  onToggleManutencao,
}: {
  truck: TruckSummary
  /** Coluna alternativa no detalhe expandido: "Motorista" (aba Por Placa) ou "Placa" (aba Por Motorista) */
  otherFieldLabel: string
  otherFieldKey: 'MOTORISTA' | 'PLACA'
  /** Manutenção (placa) ou férias (motorista) sobrepondo o período, se houver */
  ausencia?: { dias: number; aberta: boolean; motivo?: string | null }
  ausenciaLabel: 'manutenção' | 'férias'
  /** Justificativa de atraso da última viagem (truck.ultimaViagemKey), se já registrada */
  justificativa?: Justificativa
  onJustificar: (tripKey: string, motivo: string, novaPrevisao: string | null) => Promise<boolean>
  /** Valor exibido na coluna "Consumo (km/l)" da linha — placa (ConsumoPlaca) ou motorista (ConsumoMotorista, atribuído pela data da nota); bug 2026-07-30: a linha usava só `consumo`, que nunca vem preenchido na aba Por Motorista */
  consumoDisplay?: { kmPorLitro: number | null; temAlerta: boolean }
  metaConsumoKmL: number
  /** Abre o modal de detalhamento completo (compartilhado com a aba Combustível) */
  onDetalhar: () => void
  isExpanded: boolean
  isSelected: boolean
  anySelected: boolean
  onToggleExpand: () => void
  onSelect: (additive: boolean) => void
  /** Botão rápido iniciar/parar manutenção (pedido do usuário 2026-08-14) — só na aba Por Placa, ausente na aba Por Motorista. Recebe a previsão de conclusão (opcional) quando está ABRINDO a manutenção — pedido do usuário 2026-08-17. */
  onToggleManutencao?: (previsaoConclusao: string | null) => void
}) {
  const st = STATUS_STYLE[truck.status]
  const [justificando, setJustificando] = useState(false)
  const [motivoInput, setMotivoInput] = useState(justificativa?.motivo ?? '')
  const [previsaoInput, setPrevisaoInput] = useState(justificativa?.novaPrevisao?.slice(0, 10) ?? '')
  const [salvandoMotivo, setSalvandoMotivo] = useState(false)
  const [abrindoManutencao, setAbrindoManutencao] = useState(false)
  const [previsaoManutencaoInput, setPrevisaoManutencaoInput] = useState('')
  const atrasado = truck.status === 'ATRASADO' || truck.status === 'MUITO_ATRASADO'
  // Placa em manutenção em aberto: o status de atraso da viagem deixa de ser
  // o foco (o veículo está formalmente parado por um motivo já conhecido,
  // não "atrasado" numa viagem em curso) — achado real 2026-08-17: o
  // usuário reportou que a placa continuava aparecendo como "Muito
  // atrasado" mesmo depois de entrar em manutenção.
  const emManutencao = ausenciaLabel === 'manutenção' && !!ausencia?.aberta

  async function salvarJustificativa(e: React.FormEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!motivoInput.trim() || !truck.ultimaViagemKey) return
    setSalvandoMotivo(true)
    const ok = await onJustificar(truck.ultimaViagemKey, motivoInput.trim(), previsaoInput === '' ? null : previsaoInput)
    setSalvandoMotivo(false)
    if (ok) setJustificando(false)
  }

  return (
    <>
      <tr
        className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${anySelected && !isSelected ? 'opacity-40' : ''} ${isSelected ? 'bg-emerald-50' : ''}`}
        onClick={(e) => onSelect(e.ctrlKey)}
      >
        <td className="px-2 py-2">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onToggleExpand()
            }}
            className="rounded px-1 text-slate-500 hover:bg-slate-200"
            title="Ver viagens"
          >
            {isExpanded ? '▾' : '▸'}
          </button>
        </td>
        <td
          onClick={(e) => {
            e.stopPropagation()
            onDetalhar()
          }}
          title="Ver detalhamento completo"
          className="cursor-pointer px-3 py-2 font-mono font-medium hover:underline"
        >
          {truck.key}
        </td>
        <td className="px-3 py-2">{truck.secondary}</td>
        <td className="px-3 py-2 text-right">{truck.viagens}</td>
        <td className="px-3 py-2 text-right">{fmt(truck.kmAcumulado)}</td>
        <td className="px-3 py-2 text-right">{fmt(truck.pesoMedioT, 1)}</td>
        <td className="px-3 py-2 text-right">{fmt(valorPorKm(truck), 2)}</td>
        <td className="px-3 py-2 text-right">
          {consumoDisplay?.kmPorLitro != null ? (
            <span className={consumoDisplay.kmPorLitro >= metaConsumoKmL ? 'text-emerald-700' : 'text-red-600'}>
              {fmt(consumoDisplay.kmPorLitro, 2)}
              {consumoDisplay.temAlerta && ' ⚠️'}
            </span>
          ) : (
            <span className="text-slate-400">—</span>
          )}
        </td>
        <td className="px-3 py-2 text-right">{fmt(truck.ocupacaoPct)}%</td>
        <td className="px-3 py-2 text-right">
          <span className={truck.dentroMeta ? 'text-emerald-700' : 'text-red-600'}>
            {fmt(truck.ritmoPct)}%
          </span>
        </td>
        <td className="px-3 py-2 text-right">{fmt(truck.score)}</td>
        <td className="px-3 py-2 whitespace-nowrap">
          {emManutencao ? (
            <span
              className="rounded bg-violet-100 px-2 py-0.5 text-xs text-violet-800"
              title="Atraso não avaliado enquanto a placa está em manutenção — ver Cadastros → Manutenção"
            >
              🔧 Em manutenção
            </span>
          ) : (
            <span className={`rounded px-2 py-0.5 text-xs ${st.cls}`}>{st.label}</span>
          )}
          {truck.quaseAtrasado && (
            <span
              className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800"
              title="Perto de vencer o prazo de retorno"
            >
              ⚠ quase
            </span>
          )}
          {truck.composicoesVariadas && (
            <span
              className="ml-1 rounded bg-cyan-100 px-1.5 py-0.5 text-[10px] text-cyan-800"
              title={`Composições distintas nas viagens do período: ${truck.composicoesVariadas.join(', ')}`}
            >
              ⚠ composição variada
            </span>
          )}
          {ausencia && ausencia.dias > 0 && (
            <span
              className="ml-1 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] text-violet-800"
              title={ausencia.motivo ?? undefined}
            >
              {ausenciaLabel === 'manutenção' ? '🔧' : '🏖'} {fmt(ausencia.dias)}d {ausenciaLabel}
              {ausencia.aberta ? ' (em aberto)' : ''}
            </span>
          )}
          {onToggleManutencao && ausencia?.aberta && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onToggleManutencao(null)
              }}
              title="Retirar esta placa da manutenção (fecha hoje)"
              className="ml-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800 hover:bg-emerald-200"
            >
              ✓ retirar manutenção
            </button>
          )}
          {onToggleManutencao && !ausencia?.aberta && !abrindoManutencao && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                setPrevisaoManutencaoInput('')
                setAbrindoManutencao(true)
              }}
              title="Colocar esta placa em manutenção a partir de hoje"
              className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 hover:bg-slate-200"
            >
              🔧 iniciar manutenção
            </button>
          )}
          {onToggleManutencao && !ausencia?.aberta && abrindoManutencao && (
            <span className="ml-1 inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <label className="text-[10px] text-slate-500">previsão de conclusão:</label>
              <input
                type="date"
                value={previsaoManutencaoInput}
                onChange={(e) => setPrevisaoManutencaoInput(e.target.value)}
                className="rounded border border-slate-300 px-1 py-0.5 text-[10px]"
              />
              <button
                onClick={() => {
                  onToggleManutencao(previsaoManutencaoInput === '' ? null : previsaoManutencaoInput)
                  setAbrindoManutencao(false)
                }}
                className="rounded bg-emerald-700 px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-emerald-800"
              >
                confirmar
              </button>
              <button
                onClick={() => setAbrindoManutencao(false)}
                className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] hover:bg-slate-100"
              >
                cancelar
              </button>
            </span>
          )}
          <span className="block text-[11px] text-slate-500">
            {emManutencao
              ? `${fmt(truck.statusDays, 1)} dia(s) desde a última viagem — em manutenção`
              : atrasado
                ? `${fmt(truck.statusDays, 1)} dia(s) de atraso`
                : `há ${fmt(truck.statusDays, 1)} dia(s) desde a saída`}
          </span>
          {atrasado && (
            <div onClick={(e) => e.stopPropagation()} className="mt-1">
              {!justificando && justificativa && (
                <span className="text-[11px] text-slate-600">
                  Motivo: {justificativa.motivo}
                  {justificativa.novaPrevisao && (
                    <> · nova previsão: {fmtDate(justificativa.novaPrevisao)}</>
                  )}{' '}
                  <button
                    onClick={() => {
                      setMotivoInput(justificativa.motivo)
                      setPrevisaoInput(justificativa.novaPrevisao?.slice(0, 10) ?? '')
                      setJustificando(true)
                    }}
                    className="text-emerald-700 hover:underline"
                  >
                    editar
                  </button>
                </span>
              )}
              {!justificando && !justificativa && (
                <button
                  onClick={() => {
                    setMotivoInput('')
                    setPrevisaoInput('')
                    setJustificando(true)
                  }}
                  className="text-[11px] text-amber-700 hover:underline"
                >
                  Justificar atraso
                </button>
              )}
              {justificando && (
                <form onSubmit={salvarJustificativa} className="mt-1 flex flex-wrap items-center gap-1">
                  <input
                    autoFocus
                    value={motivoInput}
                    onChange={(e) => setMotivoInput(e.target.value)}
                    placeholder="descrição: ex.: fila no cliente, quebra na estrada…"
                    className="w-56 rounded border border-slate-300 px-1.5 py-0.5 text-[11px]"
                  />
                  <input
                    type="date"
                    value={previsaoInput}
                    onChange={(e) => setPrevisaoInput(e.target.value)}
                    title="Nova previsão de retorno (opcional)"
                    className="rounded border border-slate-300 px-1.5 py-0.5 text-[11px]"
                  />
                  <button
                    type="submit"
                    disabled={salvandoMotivo || !motivoInput.trim()}
                    className="rounded bg-emerald-700 px-1.5 py-0.5 text-[11px] text-white hover:bg-emerald-800 disabled:opacity-50"
                  >
                    {salvandoMotivo ? '…' : 'Salvar'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setJustificando(false)}
                    className="rounded border border-slate-300 px-1.5 py-0.5 text-[11px] hover:bg-slate-100"
                  >
                    Cancelar
                  </button>
                </form>
              )}
            </div>
          )}
        </td>
      </tr>
      {isExpanded && (
        <tr className="border-t border-slate-100 bg-slate-50">
          <td></td>
          <td colSpan={11} className="px-3 py-2">
            <table className="w-full text-xs">
              <thead className="text-left text-slate-500">
                <tr>
                  <th className="px-2 py-1">Saída</th>
                  <th className="px-2 py-1">Nota(s) fiscal(is)</th>
                  <th className="px-2 py-1">Cliente</th>
                  <th className="px-2 py-1">Produto</th>
                  <th className="px-2 py-1">{otherFieldLabel}</th>
                  <th className="px-2 py-1 text-right">Peso (t)</th>
                  <th className="px-2 py-1 text-right">M³</th>
                  <th className="px-2 py-1 text-right">KM (ida+volta)</th>
                  <th className="px-2 py-1">Retorno previsto</th>
                </tr>
              </thead>
              <tbody>
                {truck.trips.map((t, i) => (
                  <tr key={i} className="border-t border-slate-200">
                    <td className="px-2 py-1 whitespace-nowrap">
                      {fmtDate(String(t.DATASAIDA ?? ''))}
                    </td>
                    <td className="px-2 py-1 font-mono text-[11px]">
                      {String(t.NUMEROMOV ?? '—')}
                      {Number(t.MOVIMENTOS ?? 1) > 1 && (
                        <span className="ml-1 rounded bg-slate-200 px-1 text-[10px] text-slate-600">
                          {String(t.MOVIMENTOS)} NFs
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1">{String(t.NOMEFANTASIA ?? '—')}</td>
                    <td className="px-2 py-1">{String(t.TipoProduto ?? '—')}</td>
                    <td className="px-2 py-1">{String(t[otherFieldKey] ?? '—')}</td>
                    <td className="px-2 py-1 text-right">
                      {fmt(Number(t.PESOLIQUIDO ?? 0) / 1000, 1)}
                    </td>
                    <td className="px-2 py-1 text-right">
                      {fmt(Number(t.M3_TOTAL ?? 0), 1)}
                    </td>
                    <td className="px-2 py-1 text-right">{fmt(Number(t.KM_RODADO ?? 0))}</td>
                    <td className="px-2 py-1 whitespace-nowrap">
                      {t.RETORNO_PREVISTO
                        ? new Date(String(t.RETORNO_PREVISTO)).toLocaleString('pt-BR', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : 'sem rota'}
                    </td>
                    <td className="px-2 py-1">{String(t.MOVIMENTOS ?? 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  )
}

/**
 * Modal de detalhamento completo da placa/motorista — aberto ao clicar no
 * texto da placa (não na seta, que só expande as viagens rapidamente).
 * Compartilhado entre a tabela principal (Por Placa/Por Motorista) e a aba
 * Combustível, para não duplicar a mesma tela em dois lugares (pedido do
 * usuário 2026-07-30: clicar na placa em Combustível deve abrir o mesmo
 * detalhamento).
 */
function PlacaDetailModal({
  truck,
  otherFieldLabel,
  otherFieldKey,
  ausencia,
  ausenciaLabel,
  justificativa,
  consumo,
  onClose,
}: {
  truck: TruckSummary
  otherFieldLabel: string
  otherFieldKey: 'MOTORISTA' | 'PLACA'
  ausencia?: { dias: number; aberta: boolean; motivo?: string | null }
  ausenciaLabel: 'manutenção' | 'férias'
  justificativa?: Justificativa
  consumo?: ConsumoPlaca
  onClose: () => void
}) {
  const st = STATUS_STYLE[truck.status]
  const emManutencao = ausenciaLabel === 'manutenção' && !!ausencia?.aberta
  // Linhas de abastecimento "fracionado" (soma de 2+ no mesmo hodômetro/dia)
  // que o usuário expandiu para ver os itens individuais por trás da soma —
  // pedido do usuário 2026-08-03: "pode fundir [por] data mas abrir as opções".
  const [linhasExpandidas, setLinhasExpandidas] = useState<Set<number>>(new Set())
  function toggleExpandirAbastecimento(i: number) {
    setLinhasExpandidas((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }
  // Detalhamento Diesel/Arla separado (pedido do usuário 2026-08-14) — Arla
  // é qualquer produto com "ARLA" no nome; o resto (majoritariamente diesel,
  // raramente gasolina/lubrificante) cai na aba Diesel.
  const [detalheSubTab, setDetalheSubTab] = useState<'diesel' | 'arla'>('diesel')
  const detalheFiltrado = consumo?.detalhe.filter((a) => (detalheSubTab === 'arla' ? /ARLA/i.test(a.produto) : !/ARLA/i.test(a.produto))) ?? []
  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-mono text-2xl font-semibold">{truck.key}</h2>
            <p className="text-sm text-slate-500">{truck.secondary}</p>
          </div>
          <button onClick={onClose} className="rounded px-2 py-1 text-slate-500 hover:bg-slate-100">
            ✕
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {emManutencao ? (
            <span
              className="rounded-full bg-violet-100 px-3 py-1 text-sm font-medium text-violet-800"
              title="Atraso não avaliado enquanto a placa está em manutenção — ver Cadastros → Manutenção"
            >
              🔧 Em manutenção
            </span>
          ) : (
            <span className={`rounded-full px-3 py-1 text-sm font-medium ${st.cls}`}>{st.label}</span>
          )}
          {ausencia && ausencia.dias > 0 && (
            <span className="rounded-full bg-violet-100 px-3 py-1 text-sm text-violet-800">
              {ausenciaLabel === 'manutenção' ? '🔧' : '🏖'} {fmt(ausencia.dias)}d {ausenciaLabel}
              {ausencia.aberta ? ' (em aberto)' : ''}
            </span>
          )}
          {justificativa && (
            <span className="rounded-full bg-amber-100 px-3 py-1 text-sm text-amber-900">
              Motivo do atraso: {justificativa.motivo}
            </span>
          )}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="text-xs text-slate-500">Viagens</p>
            <p className="text-lg font-semibold">{fmt(truck.viagens)}</p>
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="text-xs text-slate-500">KM acumulado</p>
            <p className="text-lg font-semibold">{fmt(truck.kmAcumulado)}</p>
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="text-xs text-slate-500">Peso médio (t)</p>
            <p className="text-lg font-semibold">{fmt(truck.pesoMedioT, 1)}</p>
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="text-xs text-slate-500">Ocupação</p>
            <p className="text-lg font-semibold">{fmt(truck.ocupacaoPct)}%</p>
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="text-xs text-slate-500">Ritmo</p>
            <p className="text-lg font-semibold">{fmt(truck.ritmoPct)}%</p>
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="text-xs text-slate-500">Pontuação</p>
            <p className="text-lg font-semibold">{fmt(truck.score)}</p>
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="text-xs text-slate-500">R$/km</p>
            <p className="text-lg font-semibold">{fmt(valorPorKm(truck), 2)}</p>
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="text-xs text-slate-500">
              Consumo (km/l)
              {consumo?.temAlerta && (
                <span title="Há abastecimento(s) com consumo fora do normal — ver tabela abaixo"> ⚠️</span>
              )}
            </p>
            <p className="text-lg font-semibold">{consumo?.kmPorLitro != null ? fmt(consumo.kmPorLitro, 2) : '—'}</p>
            {consumo?.kmPorLitroEstimado && (
              <p
                className="mt-0.5 text-xs font-medium text-amber-700"
                title="Sem abastecimento de diesel válido no mês nem no anterior — mostrando o último km/l válido conhecido no histórico da placa"
              >
                estimado{consumo.kmPorLitroReferenciaEm ? ` — ref. ${fmtDateBR(consumo.kmPorLitroReferenciaEm.slice(0, 10))}` : ''}
              </p>
            )}
            {consumo && consumo.alertasCount > 0 && (
              <p
                className={`mt-0.5 text-xs font-medium ${consumo.nivelAnormalidade === 'critico' ? 'text-red-700' : 'text-amber-700'}`}
                title={`${consumo.alertasCount} de ${consumo.totalIntervalos} abastecimento(s) com alerta no período`}
              >
                anormalidade {consumo.scoreAnormalidade}%
                {consumo.nivelAnormalidade === 'critico' && ' — crítico'}
              </p>
            )}
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="text-xs text-slate-500">Arla32 (% do Diesel)</p>
            <p className={`text-lg font-semibold ${consumo?.arlaAlerta ? 'text-red-700' : ''}`}>
              {consumo?.arlaPctDiesel != null ? `${fmt(consumo.arlaPctDiesel, 1)}%` : '—'}
              {consumo?.arlaAlerta && ' ⚠️'}
            </p>
            {consumo && consumo.litrosArla > 0 && (
              <p className="mt-0.5 text-xs text-slate-500">
                {fmt(consumo.litrosArla, 1)} L no período · padrão de mercado: 3%-5%
              </p>
            )}
            {consumo?.arlaAlerta && <p className="mt-0.5 text-xs text-red-700">{consumo.arlaAlerta}</p>}
          </div>
        </div>

        {consumo && consumo.detalhe.length > 0 && (
          <div className="mt-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-medium">
                Abastecimentos
                <span className="ml-2 text-sm font-normal text-slate-500">
                  hodômetro (Officium) — km/l do intervalo desde o abastecimento anterior
                </span>
              </h3>
              {/* Diesel/Arla separados (pedido do usuário 2026-08-14) */}
              <div className="flex gap-1">
                {(['diesel', 'arla'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setDetalheSubTab(t)}
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      detalheSubTab === t ? 'bg-emerald-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {t === 'diesel' ? 'Diesel' : 'Arla32'}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-slate-500">
                  <tr>
                    <th className="px-2 py-1"></th>
                    <th className="px-2 py-1">Data/hora</th>
                    <th className="px-2 py-1">Produto</th>
                    <th className="px-2 py-1 text-right">Litros</th>
                    <th className="px-2 py-1 text-right">Hodômetro</th>
                    <th className="px-2 py-1 text-right">KM desde {detalheSubTab === 'diesel' ? 'o diesel' : 'o Arla'} anterior</th>
                    <th className="px-2 py-1 text-right">{detalheSubTab === 'diesel' ? 'km/l' : 'Arla (L/km)'} do intervalo</th>
                  </tr>
                </thead>
                <tbody>
                  {detalheFiltrado.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-2 py-4 text-center text-slate-400">
                        Nenhum abastecimento de {detalheSubTab === 'diesel' ? 'diesel' : 'Arla32'} no histórico exibido.
                      </td>
                    </tr>
                  )}
                  {detalheFiltrado.map((a, i) => (
                    <Fragment key={i}>
                    <tr
                      className={`border-t border-slate-200 ${a.noPeriodo ? '' : 'text-slate-400'} ${a.alerta ? 'bg-amber-50' : ''}`}
                      title={a.alerta ?? (a.noPeriodo ? undefined : 'Abastecimento anterior ao período — só serve de referência para o cálculo do primeiro intervalo')}
                    >
                      <td className="px-2 py-1">{a.alerta && '⚠️'}</td>
                      <td className="px-2 py-1 whitespace-nowrap">
                        {fmtDateHora(a.data)}
                        {!a.noPeriodo && <span className="ml-1 text-[10px]">(referência)</span>}
                      </td>
                      <td className="px-2 py-1">{a.produto || '—'}</td>
                      <td className="px-2 py-1 text-right">
                        {fmt(a.litros, 1)}
                        {a.fracionado && (
                          <button
                            onClick={() => toggleExpandirAbastecimento(i)}
                            className="ml-1 rounded bg-slate-200 px-1 text-[10px] text-slate-600 hover:bg-slate-300"
                            title="Soma de 2+ abastecimentos no mesmo hodômetro e mesmo dia — clique para ver cada um"
                          >
                            fracionado ({a.itens?.length ?? 2}) {linhasExpandidas.has(i) ? '▾' : '▸'}
                          </button>
                        )}
                      </td>
                      <td className="px-2 py-1 text-right">{fmt(a.hodometro)}</td>
                      {detalheSubTab === 'diesel' ? (
                        <>
                          <td className="px-2 py-1 text-right">
                            {a.kmDesdeAnterior === null ? '—' : fmt(a.kmDesdeAnterior)}
                          </td>
                          <td className="px-2 py-1 text-right">
                            {a.kmPorLitroIntervalo === null ? (
                              '—'
                            ) : (
                              <span className={a.alerta ? 'font-medium text-amber-700' : ''}>
                                {fmt(a.kmPorLitroIntervalo, 2)}
                              </span>
                            )}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-2 py-1 text-right">
                            {a.kmDesdeArlaAnterior === null ? '—' : fmt(a.kmDesdeArlaAnterior)}
                          </td>
                          <td className="px-2 py-1 text-right">
                            {a.arlaPorKmIntervalo === null ? '—' : `${fmt(a.arlaPorKmIntervalo, 3)} L/km`}
                          </td>
                        </>
                      )}
                    </tr>
                    {a.fracionado && linhasExpandidas.has(i) && a.itens && (
                      <tr className="border-t border-dashed border-slate-200 bg-slate-50">
                        <td></td>
                        <td colSpan={6} className="px-2 py-1">
                          <ul className="space-y-0.5 text-[11px] text-slate-600">
                            {a.itens.map((item, j) => (
                              <li key={j}>
                                {fmtDateHora(item.data)} — {item.produto || '—'} — {fmt(item.litros, 1)} L
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-300 font-medium">
                    <td className="px-2 py-1"></td>
                    <td className="px-2 py-1">Total do período</td>
                    <td className="px-2 py-1"></td>
                    <td className="px-2 py-1 text-right">
                      {fmt(detalheSubTab === 'diesel' ? consumo.litrosConsiderados : consumo.litrosArla, 1)}
                    </td>
                    <td className="px-2 py-1"></td>
                    <td className="px-2 py-1 text-right">{detalheSubTab === 'diesel' ? fmt(consumo.kmRodado) : '—'}</td>
                    <td className="px-2 py-1 text-right">
                      {detalheSubTab === 'diesel'
                        ? consumo.kmPorLitro === null
                          ? '—'
                          : fmt(consumo.kmPorLitro, 2)
                        : consumo.arlaPctDiesel === null
                          ? '—'
                          : `${fmt(consumo.arlaPctDiesel, 1)}% do diesel`}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        <div className="mt-6">
          <h3 className="font-medium">Viagens</h3>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-slate-500">
                <tr>
                  <th className="px-2 py-1">Saída</th>
                  <th className="px-2 py-1">Nota(s) fiscal(is)</th>
                  <th className="px-2 py-1">Cliente</th>
                  <th className="px-2 py-1">Produto</th>
                  <th className="px-2 py-1">{otherFieldLabel}</th>
                  <th className="px-2 py-1 text-right">Peso (t)</th>
                  <th className="px-2 py-1 text-right">M³</th>
                  <th className="px-2 py-1 text-right">KM (ida+volta)</th>
                  <th className="px-2 py-1">Retorno previsto</th>
                </tr>
              </thead>
              <tbody>
                {truck.trips.map((t, i) => (
                  <tr key={i} className="border-t border-slate-200">
                    <td className="px-2 py-1 whitespace-nowrap">{fmtDate(String(t.DATASAIDA ?? ''))}</td>
                    <td className="px-2 py-1 font-mono text-[11px]">
                      {String(t.NUMEROMOV ?? '—')}
                      {Number(t.MOVIMENTOS ?? 1) > 1 && (
                        <span className="ml-1 rounded bg-slate-200 px-1 text-[10px] text-slate-600">
                          {String(t.MOVIMENTOS)} NFs
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1">{String(t.NOMEFANTASIA ?? '—')}</td>
                    <td className="px-2 py-1">{String(t.TipoProduto ?? '—')}</td>
                    <td className="px-2 py-1">{String(t[otherFieldKey] ?? '—')}</td>
                    <td className="px-2 py-1 text-right">{fmt(Number(t.PESOLIQUIDO ?? 0) / 1000, 1)}</td>
                    <td className="px-2 py-1 text-right">{fmt(Number(t.M3_TOTAL ?? 0), 1)}</td>
                    <td className="px-2 py-1 text-right">{fmt(Number(t.KM_RODADO ?? 0))}</td>
                    <td className="px-2 py-1 whitespace-nowrap">
                      {t.RETORNO_PREVISTO
                        ? new Date(String(t.RETORNO_PREVISTO)).toLocaleString('pt-BR', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : 'sem rota'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
