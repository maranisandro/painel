'use client'

import { Bar, BarChart, Cell, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { NameValue, TurnoverMes } from '@/lib/rh/funcionarios'

function opacityFor(name: string, selected: Set<string>): number {
  if (selected.size === 0) return 1
  return selected.has(name) ? 1 : 0.25
}

/** Barra horizontal cross-filtrável — clique troca a seleção, Ctrl+clique
 *  adiciona/remove, mesmo comportamento definido para todos os painéis. */
export function SelectableBarChart({
  data,
  title,
  selected,
  onSelect,
  height = 260,
}: {
  data: NameValue[]
  title: string
  selected: Set<string>
  onSelect: (name: string, ctrl: boolean) => void
  height?: number
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="font-medium">{title}</h2>
      <div className="mt-2" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
            <XAxis type="number" tick={{ fontSize: 12 }} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={140} />
            <Tooltip formatter={(v) => Number(v).toLocaleString('pt-BR')} />
            <Bar
              dataKey="value"
              radius={[0, 4, 4, 0]}
              isAnimationActive={false}
              className="cursor-pointer"
              onClick={(entry: { name?: string }, _index: number, e: React.MouseEvent) =>
                entry?.name && onSelect(entry.name, e.ctrlKey || e.metaKey)
              }
            >
              {data.map((d, i) => (
                <Cell key={i} fill="#047857" fillOpacity={opacityFor(d.name, selected)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {data.length === 0 && <p className="mt-2 text-sm text-slate-500">Sem dados no filtro atual.</p>}
    </div>
  )
}

function fmtMes(ym: string): string {
  const [ano, mes] = ym.split('-')
  return `${mes}/${ano.slice(2)}`
}

/** Admissões/desligamentos (barras) + % de turnover (linha, eixo secundário) mês a mês. */
export function TurnoverChart({ data, title }: { data: TurnoverMes[]; title: string }) {
  const chartData = data.map((d) => ({ ...d, label: fmtMes(d.mes) }))
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="font-medium">{title}</h2>
      <div className="mt-2 h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
            <XAxis dataKey="label" tick={{ fontSize: 12 }} />
            <YAxis yAxisId="qtd" tick={{ fontSize: 12 }} width={48} allowDecimals={false} />
            <YAxis yAxisId="pct" orientation="right" tick={{ fontSize: 12 }} width={48} unit="%" />
            <Tooltip
              formatter={(v, name) => (name === 'Turnover' ? [`${Number(v).toFixed(1)}%`, name] : [Number(v).toLocaleString('pt-BR'), name])}
            />
            <Legend />
            <Bar yAxisId="qtd" dataKey="admissoes" name="Admissões" fill="#0e7490" radius={[4, 4, 0, 0]} isAnimationActive={false} />
            <Bar yAxisId="qtd" dataKey="desligamentos" name="Desligamentos" fill="#be123c" radius={[4, 4, 0, 0]} isAnimationActive={false} />
            <Line
              yAxisId="pct"
              type="monotone"
              dataKey="turnoverPercentual"
              name="Turnover"
              stroke="#6d28d9"
              strokeWidth={2}
              dot={{ r: 3 }}
              isAnimationActive={false}
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
