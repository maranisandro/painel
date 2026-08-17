'use client'

import { useMemo, useState } from 'react'
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

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
}: {
  trips: Record<string, unknown>[]
  custoMesRegistrado: Record<string, number>
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
      const custoCadastrado = custoMesRegistrado[ym] ?? 0
      const custoPorKm = kmTotal > 0 ? custoCadastrado / kmTotal : null
      const custoPorTonelada = pesoT > 0 ? custoCadastrado / pesoT : null
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
      })
    }
    return out
  }, [trips, custoMesRegistrado, ano])

  const temAlgumDado = dadosPorMes.some((m) => m.custoCadastrado > 0 || m.kmTotal > 0)

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

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="mb-2 text-xs font-medium text-slate-600">Custo do mês cadastrado (R$) e variação % vs. mês anterior</p>
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
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              <th className="px-4 py-2">Mês</th>
              <th className="px-4 py-2 text-right">Custo cadastrado</th>
              <th className="px-4 py-2 text-right">Var. custo %</th>
              <th className="px-4 py-2 text-right">KM rodado</th>
              <th className="px-4 py-2 text-right">Peso (t)</th>
              <th className="px-4 py-2 text-right">R$/km</th>
              <th className="px-4 py-2 text-right">Var. R$/km %</th>
              <th className="px-4 py-2 text-right">R$/tonelada</th>
              <th className="px-4 py-2 text-right">Var. R$/tonelada %</th>
            </tr>
          </thead>
          <tbody>
            {dadosPorMes.map((m) => (
              <tr key={m.ym} className="border-t border-slate-100">
                <td className="px-4 py-2">{m.mes}</td>
                <td className="px-4 py-2 text-right">{fmtMoeda(m.custoCadastrado)}</td>
                <td className="px-4 py-2 text-right">{fmtPct(m.variacaoCustoPct)}</td>
                <td className="px-4 py-2 text-right">{fmt(m.kmTotal)}</td>
                <td className="px-4 py-2 text-right">{fmt(m.pesoT, 1)}</td>
                <td className="px-4 py-2 text-right">{m.custoPorKm != null ? fmtMoeda(m.custoPorKm) : '—'}</td>
                <td className="px-4 py-2 text-right">{fmtPct(m.variacaoCustoPorKmPct)}</td>
                <td className="px-4 py-2 text-right">{m.custoPorTonelada != null ? fmtMoeda(m.custoPorTonelada) : '—'}</td>
                <td className="px-4 py-2 text-right">{fmtPct(m.variacaoCustoPorToneladaPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
