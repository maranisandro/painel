'use client'

import { useEffect, useMemo, useState } from 'react'
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { SortableTable } from '@/components/shared/SortableTable'
import { horasCalendarioUtilNoIntervalo } from '@/lib/fase1/calendario-util'
import { classificarMotivoManutencao, classificarMotivoAtraso } from '@/lib/fase1/motivo-classificacao'

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

// Mesmo recorte padrão do painel tático (DEFAULT_FILTERS em Fase1Dashboard):
// frota própria, só os 3 produtos que o custo mensal cadastrado cobre — sem
// isso o R$/km e R$/tonelada ficam diluídos por viagens de terceiro/outros
// produtos que não fazem parte do custo lançado.
const PRODUTOS_ESCOPO = new Set(['Carvão', 'Cavaco', 'Maravalha'])

function fmt(n: number, digits = 0): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: digits })
}
function fmtMoeda(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}
function fmtPct(n: number | null): string {
  return n === null ? '—' : `${n > 0 ? '+' : ''}${n.toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`
}
/** null quando não há mês anterior válido para comparar (primeiro mês do ano, ou anterior sem base > 0). */
function variacaoPct(atual: number, anterior: number | null): number | null {
  if (anterior === null || anterior === 0) return null
  return ((atual - anterior) / anterior) * 100
}

interface CustoMesAtual {
  ym: string
  lancado: number
  ateHoje: number
  projetadoFechamento: number
  custoDiaBase: number
  diasDecorridos: number
  diasDoMes: number
}

interface MesEstrategico {
  mes: string
  ym: string
  custoCadastrado: number
  kmTotal: number
  pesoT: number
  custoPorKm: number | null
  custoPorTonelada: number | null
  /** % de variação vs. mês anterior — pedido do usuário 2026-08-13 ("% de aumento e redução de custo e custos unitários mensalmente"). */
  variacaoCustoPct: number | null
  variacaoCustoPorKmPct: number | null
  variacaoCustoPorToneladaPct: number | null
  /** Mês em andamento — pedido do usuário 2026-08-20: "utilizem um proporcional
   * com o ritmo para que não fique uma variação grande de valor parcial...
   * poderia ter o numero real e as informações de proporção e ritmo". Quando
   * true, `custoCadastrado` já é a PROJEÇÃO de fechamento (comparável aos
   * meses fechados), não o valor parcial lançado — o valor real fica em
   * `custoReal`.
   */
  isMesAtual: boolean
  custoReal: number
  ritmoDiario: number | null
  diasDecorridos: number | null
  diasDoMes: number | null
}

/**
 * Painel estratégico anual do Transporte Rodoviário (pedido do usuário
 * 2026-08-13: "montar uma aba de análise estratégica por ano... gráfico com
 * o custo do mês (parâmetro) e gerar o custo por tonelada e KM de acordo com
 * a apuração"). Primeira versão: custo cadastrado (CUSTO_MES_<AAAAMM>) mês a
 * mês no ano, e o R$/km e R$/tonelada resultantes contra o KM/peso realmente
 * apurado nas viagens daquele mês (mesmo escopo do painel tático: frota
 * própria, Carvão/Cavaco/Maravalha).
 */
export function Fase1Estrategico({
  trips,
  custoMesRegistrado,
  custoMesAtual,
}: {
  trips: Record<string, unknown>[]
  custoMesRegistrado: Record<string, number>
  custoMesAtual: CustoMesAtual | null
}) {
  const anosDisponiveis = useMemo(() => {
    const anos = new Set<string>()
    for (const t of trips) {
      const ano = String(t.DATASAIDA ?? '').slice(0, 4)
      if (/^\d{4}$/.test(ano)) anos.add(ano)
    }
    return [...anos].sort()
  }, [trips])

  const [ano, setAno] = useState(() => String(new Date().getFullYear()))
  const anos = anosDisponiveis.length ? anosDisponiveis : [ano]

  const dadosPorMes = useMemo<MesEstrategico[]>(() => {
    const out: MesEstrategico[] = []
    for (let mes = 1; mes <= 12; mes++) {
      const mesStr = String(mes).padStart(2, '0')
      const ym = `${ano}${mesStr}`
      const doMes = trips.filter(
        (t) =>
          String(t.DATASAIDA ?? '').slice(0, 7) === `${ano}-${mesStr}` &&
          String(t['Consolida Transportadora'] ?? '') === 'Proprio' &&
          PRODUTOS_ESCOPO.has(String(t.TipoProduto ?? '')),
      )
      const kmTotal = doMes.reduce((s, t) => s + (Number(t.KM_RODADO) || 0), 0)
      const pesoT = doMes.reduce((s, t) => s + (Number(t.PESOLIQUIDO) || 0), 0) / 1000
      const isMesAtual = custoMesAtual !== null && ym === custoMesAtual.ym
      // Mês em andamento: o valor lançado até agora é parcial (poucos dias
      // do mês) e, contra meses já fechados, gera uma variação % enorme e
      // enganosa. Usa a MESMA projeção de fechamento (ritmo R$/dia, com
      // fallback pra média histórica quando o lançamento está atrasado) já
      // calculada para o painel tático — pedido do usuário 2026-08-20. Pro
      // R$/km e R$/tonelada, usa o custo "até hoje" no ritmo (mesma janela de
      // dias que o KM/peso já apurado), não o lançado bruto nem o projetado
      // do mês inteiro (que infla o card ao dividir por só alguns dias de KM).
      const custoCadastrado = isMesAtual ? custoMesAtual!.projetadoFechamento : (custoMesRegistrado[ym] ?? 0)
      const custoParaRazao = isMesAtual ? custoMesAtual!.ateHoje : custoCadastrado
      const custoPorKm = kmTotal > 0 ? custoParaRazao / kmTotal : null
      const custoPorTonelada = pesoT > 0 ? custoParaRazao / pesoT : null
      // Comparação só dentro do ano selecionado — janeiro nunca tem variação
      // (não busca dezembro do ano anterior, que está fora do escopo `trips`
      // atual do componente).
      const anterior = out[out.length - 1] ?? null
      out.push({
        mes: MESES[mes - 1],
        ym,
        custoCadastrado,
        kmTotal,
        pesoT,
        custoPorKm,
        custoPorTonelada,
        variacaoCustoPct: variacaoPct(custoCadastrado, anterior?.custoCadastrado ?? null),
        variacaoCustoPorKmPct: custoPorKm !== null ? variacaoPct(custoPorKm, anterior?.custoPorKm ?? null) : null,
        variacaoCustoPorToneladaPct: custoPorTonelada !== null ? variacaoPct(custoPorTonelada, anterior?.custoPorTonelada ?? null) : null,
        isMesAtual,
        custoReal: isMesAtual ? custoMesAtual!.lancado : custoCadastrado,
        ritmoDiario: isMesAtual ? custoMesAtual!.custoDiaBase : null,
        diasDecorridos: isMesAtual ? custoMesAtual!.diasDecorridos : null,
        diasDoMes: isMesAtual ? custoMesAtual!.diasDoMes : null,
      })
    }
    return out
  }, [trips, custoMesRegistrado, custoMesAtual, ano])

  const temAlgumDado = dadosPorMes.some((m) => m.custoCadastrado > 0 || m.kmTotal > 0)
  const mesAtualNoAno = dadosPorMes.find((m) => m.isMesAtual) ?? null

  // Principais motivos de falta de Disponibilidade Mecânica (manutenção) e
  // de Eficiência (atraso justificado) — pedido do usuário 2026-08-20: "os
  // motivos são digitação aberta, tentar consolidar os descritivos com
  // motivos mais objetivos". Busca à parte (não vem em `trips`/`custoMesAtual`
  // — o ano estratégico é independente do período tático De/Até).
  const [motivosData, setMotivosData] = useState<{
    manutencoes: { placa: string; startDate: string; endDate: string | null; motivo: string }[]
    justificativas: { tripKey: string; motivo: string }[]
  } | null>(null)
  useEffect(() => {
    let cancelado = false
    fetch(`/api/fase1/estrategico/motivos?ano=${ano}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelado) setMotivosData(d)
      })
    return () => {
      cancelado = true
    }
  }, [ano])

  const motivosManutencao = useMemo(() => {
    if (!motivosData) return []
    const inicioAno = `${ano}-01-01`
    const fimAno = `${ano}-12-31`
    const hoje = new Date().toISOString().slice(0, 10)
    const porCategoria = new Map<string, { horas: number; ocorrencias: number; exemplos: Set<string> }>()
    for (const m of motivosData.manutencoes) {
      const horas = horasCalendarioUtilNoIntervalo(m.startDate, m.endDate ?? hoje, inicioAno, fimAno)
      if (horas <= 0) continue
      const categoria = classificarMotivoManutencao(m.motivo)
      const entry = porCategoria.get(categoria) ?? { horas: 0, ocorrencias: 0, exemplos: new Set<string>() }
      entry.horas += horas
      entry.ocorrencias += 1
      if (m.motivo) entry.exemplos.add(m.motivo)
      porCategoria.set(categoria, entry)
    }
    return [...porCategoria.entries()]
      .map(([categoria, e]) => ({ categoria, horas: e.horas, ocorrencias: e.ocorrencias, exemplos: [...e.exemplos] }))
      .sort((a, b) => b.horas - a.horas)
  }, [motivosData, ano])

  const motivosAtraso = useMemo(() => {
    if (!motivosData) return []
    const justPorKey = new Map(motivosData.justificativas.map((j) => [j.tripKey, j.motivo]))
    const porCategoria = new Map<string, { ocorrencias: number; exemplos: Set<string> }>()
    for (const t of trips) {
      const dataSaida = String(t.DATASAIDA ?? '').slice(0, 10)
      if (dataSaida.slice(0, 4) !== ano) continue
      const key = String(t.VIAGEM_KEY ?? '')
      const motivo = justPorKey.get(key)
      if (!motivo) continue
      const categoria = classificarMotivoAtraso(motivo)
      const entry = porCategoria.get(categoria) ?? { ocorrencias: 0, exemplos: new Set<string>() }
      entry.ocorrencias += 1
      entry.exemplos.add(motivo)
      porCategoria.set(categoria, entry)
    }
    return [...porCategoria.entries()]
      .map(([categoria, e]) => ({ categoria, ocorrencias: e.ocorrencias, exemplos: [...e.exemplos] }))
      .sort((a, b) => b.ocorrencias - a.ocorrencias)
  }, [motivosData, trips, ano])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div>
          <label className="block text-xs font-medium text-slate-600">Ano</label>
          <select
            value={ano}
            onChange={(e) => setAno(e.target.value)}
            className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            {anos.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-slate-500">
          Custo cadastrado em Parâmetros (CUSTO_MES_AAAAMM) x KM rodado/peso transportado apurado nas viagens
          (frota própria, Carvão/Cavaco/Maravalha — mesmo recorte do painel tático).
        </p>
      </div>

      {!temAlgumDado && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Nenhum custo cadastrado nem viagem apurada para {ano} ainda.
        </div>
      )}

      {mesAtualNoAno && (
        <div className="rounded-lg border border-sky-300 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          <strong>{mesAtualNoAno.mes}/{ano} em andamento</strong> ({mesAtualNoAno.diasDecorridos}/{mesAtualNoAno.diasDoMes} dias) —
          gráficos e variação usam a projeção de fechamento no ritmo atual (R$ {fmt(mesAtualNoAno.custoCadastrado)}, ritmo R${' '}
          {fmt(mesAtualNoAno.ritmoDiario ?? 0)}/dia), pra não distorcer a comparação com meses fechados. Real lançado até agora: R${' '}
          {fmt(mesAtualNoAno.custoReal)}.
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="mb-2 text-xs font-medium text-slate-600">
          Custo do mês cadastrado (R$) e variação % vs. mês anterior
          {mesAtualNoAno && <span className="ml-1 font-normal text-sky-700">— {mesAtualNoAno.mes} usa projeção de fechamento (ritmo)</span>}
        </p>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={dadosPorMes} margin={{ top: 20, right: 8, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
            <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
            <YAxis yAxisId="valor" tick={{ fontSize: 11 }} tickFormatter={(v) => fmt(Number(v) / 1000, 0) + 'k'} />
            <YAxis yAxisId="pct" orientation="right" tick={{ fontSize: 11 }} unit="%" />
            <Tooltip formatter={(v, name) => (name === 'Variação' ? [fmtPct(Number(v)), name] : [fmtMoeda(Number(v)), name])} />
            <Legend />
            <Bar yAxisId="valor" dataKey="custoCadastrado" name="Custo do mês" fill="#047857" radius={[4, 4, 0, 0]} isAnimationActive={false} />
            <Line
              yAxisId="pct"
              type="monotone"
              dataKey="variacaoCustoPct"
              name="Variação"
              stroke="#b45309"
              strokeWidth={2}
              dot={{ r: 3 }}
              isAnimationActive={false}
              connectNulls
              label={{ position: 'top', fill: '#b45309', fontSize: 11, formatter: (v: unknown) => (v === null || v === undefined ? '' : fmtPct(Number(v))) }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="mb-2 text-xs font-medium text-slate-600">Custo R$/km apurado e variação % vs. mês anterior</p>
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={dadosPorMes} margin={{ top: 20, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="valor" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="pct" orientation="right" tick={{ fontSize: 11 }} unit="%" />
              <Tooltip formatter={(v, name) => (name === 'Variação' ? [fmtPct(Number(v)), name] : [fmtMoeda(Number(v)), name])} />
              <Legend />
              <Line yAxisId="valor" type="monotone" dataKey="custoPorKm" name="R$/km" stroke="#0e7490" strokeWidth={2} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
              <Line
                yAxisId="pct"
                type="monotone"
                dataKey="variacaoCustoPorKmPct"
                name="Variação"
                stroke="#b45309"
                strokeWidth={2}
                strokeDasharray="4 3"
                dot={{ r: 3 }}
                connectNulls
                isAnimationActive={false}
                label={{ position: 'top', fill: '#b45309', fontSize: 11, formatter: (v: unknown) => (v === null || v === undefined ? '' : fmtPct(Number(v))) }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="mb-2 text-xs font-medium text-slate-600">Custo R$/tonelada apurado e variação % vs. mês anterior</p>
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={dadosPorMes} margin={{ top: 20, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="valor" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="pct" orientation="right" tick={{ fontSize: 11 }} unit="%" />
              <Tooltip formatter={(v, name) => (name === 'Variação' ? [fmtPct(Number(v)), name] : [fmtMoeda(Number(v)), name])} />
              <Legend />
              <Line yAxisId="valor" type="monotone" dataKey="custoPorTonelada" name="R$/tonelada" stroke="#b45309" strokeWidth={2} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
              <Line
                yAxisId="pct"
                type="monotone"
                dataKey="variacaoCustoPorToneladaPct"
                name="Variação"
                stroke="#6d28d9"
                strokeWidth={2}
                strokeDasharray="4 3"
                dot={{ r: 3 }}
                connectNulls
                isAnimationActive={false}
                label={{ position: 'top', fill: '#6d28d9', fontSize: 11, formatter: (v: unknown) => (v === null || v === undefined ? '' : fmtPct(Number(v))) }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <SortableTable
          rows={dadosPorMes}
          rowKey={(m) => m.ym}
          defaultSortKey="mes"
          defaultSortDir="asc"
          columns={[
            {
              key: 'mes',
              label: 'Mês',
              sortValue: (m) => m.ym,
              render: (m) => (
                <span>
                  {m.mes}
                  {m.isMesAtual && (
                    <span
                      className="ml-1 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-800"
                      title={`Em andamento: ${m.diasDecorridos}/${m.diasDoMes} dias`}
                    >
                      em andamento
                    </span>
                  )}
                </span>
              ),
            },
            {
              key: 'custo',
              label: 'Custo (projeção no mês atual)',
              align: 'right',
              sortValue: (m) => m.custoCadastrado,
              render: (m) => fmtMoeda(m.custoCadastrado),
            },
            {
              key: 'custoReal',
              label: 'Real lançado (mês atual)',
              align: 'right',
              sortValue: (m) => (m.isMesAtual ? m.custoReal : -1),
              render: (m) => (m.isMesAtual ? fmtMoeda(m.custoReal) : '—'),
            },
            {
              key: 'ritmo',
              label: 'Ritmo R$/dia (mês atual)',
              align: 'right',
              sortValue: (m) => m.ritmoDiario ?? -1,
              render: (m) => (m.ritmoDiario != null ? `${fmtMoeda(m.ritmoDiario)}/dia` : '—'),
            },
            { key: 'varCusto', label: 'Var. custo %', align: 'right', sortValue: (m) => m.variacaoCustoPct ?? -Infinity, render: (m) => fmtPct(m.variacaoCustoPct) },
            { key: 'km', label: 'KM rodado', align: 'right', sortValue: (m) => m.kmTotal, render: (m) => fmt(m.kmTotal) },
            { key: 'peso', label: 'Peso (t)', align: 'right', sortValue: (m) => m.pesoT, render: (m) => fmt(m.pesoT, 1) },
            { key: 'rskm', label: 'R$/km', align: 'right', sortValue: (m) => m.custoPorKm ?? -1, render: (m) => (m.custoPorKm != null ? fmtMoeda(m.custoPorKm) : '—') },
            { key: 'varRskm', label: 'Var. R$/km %', align: 'right', sortValue: (m) => m.variacaoCustoPorKmPct ?? -Infinity, render: (m) => fmtPct(m.variacaoCustoPorKmPct) },
            { key: 'rst', label: 'R$/tonelada', align: 'right', sortValue: (m) => m.custoPorTonelada ?? -1, render: (m) => (m.custoPorTonelada != null ? fmtMoeda(m.custoPorTonelada) : '—') },
            { key: 'varRst', label: 'Var. R$/tonelada %', align: 'right', sortValue: (m) => m.variacaoCustoPorToneladaPct ?? -Infinity, render: (m) => fmtPct(m.variacaoCustoPorToneladaPct) },
          ]}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-4">
          <p className="mb-1 text-sm font-medium text-slate-700">Principais motivos de indisponibilidade mecânica — {ano}</p>
          <p className="mb-2 text-xs text-slate-500">
            Motivo digitado na manutenção, consolidado em categorias objetivas. Clique numa linha pra ver as
            descrições originais.
          </p>
          <SortableTable
            rows={motivosManutencao}
            rowKey={(m) => m.categoria}
            defaultSortKey="horas"
            defaultSortDir="desc"
            emptyMessage="Nenhuma manutenção registrada no ano."
            renderExpanded={(m) => (
              <ul className="list-inside list-disc space-y-0.5 text-xs text-slate-600">
                {m.exemplos.map((ex, i) => (
                  <li key={i}>{ex}</li>
                ))}
              </ul>
            )}
            columns={[
              { key: 'categoria', label: 'Motivo (consolidado)', sortValue: (m) => m.categoria, render: (m) => m.categoria },
              { key: 'horas', label: 'Horas úteis perdidas', align: 'right', sortValue: (m) => m.horas, render: (m) => fmt(m.horas) },
              { key: 'ocorrencias', label: 'Ocorrências', align: 'right', sortValue: (m) => m.ocorrencias, render: (m) => m.ocorrencias },
            ]}
          />
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-4">
          <p className="mb-1 text-sm font-medium text-slate-700">Principais motivos de baixa eficiência (atraso) — {ano}</p>
          <p className="mb-2 text-xs text-slate-500">
            Motivo digitado ao justificar o atraso, consolidado em categorias objetivas. Clique numa linha pra ver as
            descrições originais.
          </p>
          <SortableTable
            rows={motivosAtraso}
            rowKey={(m) => m.categoria}
            defaultSortKey="ocorrencias"
            defaultSortDir="desc"
            emptyMessage="Nenhuma justificativa de atraso no ano."
            renderExpanded={(m) => (
              <ul className="list-inside list-disc space-y-0.5 text-xs text-slate-600">
                {m.exemplos.map((ex, i) => (
                  <li key={i}>{ex}</li>
                ))}
              </ul>
            )}
            columns={[
              { key: 'categoria', label: 'Motivo (consolidado)', sortValue: (m) => m.categoria, render: (m) => m.categoria },
              { key: 'ocorrencias', label: 'Ocorrências', align: 'right', sortValue: (m) => m.ocorrencias, render: (m) => m.ocorrencias },
            ]}
          />
        </div>
      </div>
    </div>
  )
}
