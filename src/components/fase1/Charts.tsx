'use client'

import {
  Bar,
  BarChart,
  Cell,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

const COLORS = ['#047857', '#0e7490', '#b45309', '#6d28d9', '#be123c', '#475569']

export interface NameValue {
  name: string
  value: number
}

export interface SelectableChartProps {
  data: NameValue[]
  title: string
  /** valores selecionados nesta dimensão (vazio = sem filtro) */
  selected: string[]
  /** clique num elemento: additive=true quando Ctrl pressionado */
  onSelect: (name: string, additive: boolean) => void
}

function opacityFor(name: string, selected: string[]): number {
  if (selected.length === 0) return 1
  return selected.includes(name) ? 1 : 0.25
}

export function TripsBarChart({ data, title, selected, onSelect }: SelectableChartProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="font-medium">{title}</h2>
      <div className="mt-2 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
            <XAxis dataKey="name" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip formatter={(v) => Number(v).toLocaleString('pt-BR')} />
            <Bar
              dataKey="value"
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
              className="cursor-pointer"
              onClick={(entry: { name?: string }, _index: number, e: React.MouseEvent) =>
                entry?.name && onSelect(entry.name, e.ctrlKey)
              }
            >
              {data.map((d, i) => (
                <Cell key={i} fill="#047857" fillOpacity={opacityFor(d.name, selected)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

/**
 * Comparativo mensal com eixo duplo: barras = média de KM por placa (métrica
 * justa quando o nº de caminhões varia), linha = nº de placas ativas no mês.
 */
export function MonthlyPerformanceChart({
  data,
  title,
  subtitle,
}: {
  data: {
    label: string
    km: number
    kmPorPlaca: number
    placas: number
    viagens: number
    variacaoPct: number | null
    tendencia: number | null
  }[]
  title: string
  subtitle?: string
}) {
  const fmtKm = (v: unknown) => Number(v).toLocaleString('pt-BR')
  const fmtPct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="font-medium">{title}</h2>
      {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
      <div className="mt-2 h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 24, right: 8, left: 8, bottom: 8 }}>
            <XAxis dataKey="label" tick={{ fontSize: 12 }} />
            <YAxis yAxisId="km" tick={{ fontSize: 12 }} width={64} />
            <YAxis
              yAxisId="placas"
              orientation="right"
              tick={{ fontSize: 12 }}
              width={40}
              allowDecimals={false}
            />
            <Tooltip
              formatter={(v, name, entry) => {
                if (name === 'Placas') return [fmtKm(v), 'Placas']
                if (name === 'Viagens') return [fmtKm(v), 'Viagens']
                if (name === 'KM médio por placa') {
                  const pct = (entry?.payload as { variacaoPct?: number | null } | undefined)?.variacaoPct
                  const pctTxt = pct === null || pct === undefined ? '' : ` (${fmtPct(pct)} vs mês anterior)`
                  return [`${fmtKm(v)} km${pctTxt}`, name]
                }
                return [`${fmtKm(v)} km`, name]
              }}
            />
            <Legend />
            <Bar
              yAxisId="km"
              dataKey="kmPorPlaca"
              name="KM médio por placa"
              fill="#0e7490"
              radius={[4, 4, 0, 0]}
              // sem animação: rótulos aparecem imediatamente e a cross-filtragem responde na hora
              isAnimationActive={false}
              // rótulo no interior da barra
              label={{ position: 'inside', fill: '#ffffff', fontSize: 11, formatter: fmtKm }}
            >
              {/* % de ganho/perda vs. mês anterior, acima da barra (pedido do
                  usuário 2026-08-17) — cor por sinal, já que o LabelList
                  padrão não tem como colorir condicionalmente por ponto */}
              <LabelList
                dataKey="variacaoPct"
                position="top"
                content={(props: unknown) => {
                  const { x, y, width, value } = props as {
                    x: number
                    y: number
                    width: number
                    value: number | null | undefined
                  }
                  if (value === null || value === undefined) return null
                  const positivo = value >= 0
                  return (
                    <text
                      x={Number(x) + Number(width) / 2}
                      y={Number(y) - 6}
                      textAnchor="middle"
                      fontSize={11}
                      fontWeight={600}
                      fill={positivo ? '#047857' : '#b91c1c'}
                    >
                      {fmtPct(value)}
                    </text>
                  )
                }}
              />
            </Bar>
            <Line
              yAxisId="placas"
              type="monotone"
              dataKey="placas"
              name="Placas"
              stroke="#b45309"
              strokeWidth={2}
              dot={{ r: 3 }}
              isAnimationActive={false}
              // rótulo acima da linha
              label={{ position: 'top', fill: '#b45309', fontSize: 11, offset: 8 }}
            />
            {/* ponto de tendência do mês atual: projeção do KM/placa no fechamento */}
            <Scatter
              yAxisId="km"
              dataKey="tendencia"
              name="Tendência do mês (projeção no fechamento)"
              fill="#6d28d9"
              shape="diamond"
              isAnimationActive={false}
            >
              {/* Scatter não preenche o value do rótulo — o LabelList busca do payload */}
              <LabelList
                dataKey="tendencia"
                position="top"
                fill="#6d28d9"
                fontSize={11}
                offset={8}
                formatter={(v: unknown) => (v === null || v === undefined ? '' : fmtKm(v))}
              />
            </Scatter>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export function FreightPieChart({ data, title, selected, onSelect }: SelectableChartProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="font-medium">{title}</h2>
      <div className="mt-2 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius={50}
              outerRadius={80}
              label
              isAnimationActive={false}
              className="cursor-pointer"
              onClick={(entry: { name?: string }, _index: number, e: React.MouseEvent) =>
                entry?.name && onSelect(entry.name, e.ctrlKey)
              }
            >
              {data.map((d, i) => (
                <Cell
                  key={i}
                  fill={COLORS[i % COLORS.length]}
                  fillOpacity={opacityFor(d.name, selected)}
                />
              ))}
            </Pie>
            <Tooltip formatter={(v) => Number(v).toLocaleString('pt-BR')} />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
