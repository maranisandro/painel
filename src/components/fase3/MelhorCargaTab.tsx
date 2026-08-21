'use client'

import { useEffect, useState } from 'react'
import { DateRangeInputs, fmtDateBR } from '@/components/shared/DateRangeInputs'
import { SortableTable, type SortableColumn } from '@/components/shared/SortableTable'

interface ResumoTipoTabela {
  subTipoProduto: string
  tabelaPreco: string
  n: number
  m3Total: number
  valorM3Medio: number | null
  precoPonderado: number | null
}

interface CargaProduto {
  produto: string
  quantidade: number
  m3Total: number
  valorBruto: number
}

interface CargaNota {
  numeroMov: string
  cliente: string
  m3Total: number
  faturamentoBruto: number
  produtos: CargaProduto[]
}

interface Carga {
  chave: string
  placa: string
  data: string
  numLinhas: number
  distribuidor: string
  cliente: string
  tipoProdutoPrincipal: string
  subTipoProdutoPrincipal: string
  tabelaPreco: string
  m3Total: number
  faturamentoBruto: number
  valorM3: number | null
  precoPonderado: number | null
  abaixoDoMinimo: boolean
  produtos: CargaProduto[]
  notas: CargaNota[]
}

interface DirecionamentoCliente {
  cliente: string
  numCargas: number
  melhorCarga: Carga
}

interface MelhorCargaData {
  period: { from: string; to: string }
  totalCargas: number
  cargasComMultiplasNotas: number
  linhasSemPlaca: number
  m3MinimoCarga: number
  resumoPorTipoTabela: ResumoTipoTabela[]
  melhoresCargas: Carga[]
  pioresCargas: Carga[]
  direcionamentoPorCliente: DirecionamentoCliente[]
}

function fmt(n: number, digits = 0): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: digits })
}
function fmtMoeda(n: number | null): string {
  if (n == null) return '—'
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 })
}
function monthStart(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}
function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function colunasCarga(): SortableColumn<Carga>[] {
  return [
    { key: 'data', label: 'Data', sortValue: (c) => c.data, render: (c) => fmtDateBR(c.data) },
    { key: 'placa', label: 'Placa', sortValue: (c) => c.placa, render: (c) => c.placa },
    {
      key: 'notas',
      label: 'NFs',
      align: 'right',
      sortValue: (c) => c.notas.length,
      render: (c) => fmt(c.notas.length),
    },
    {
      key: 'numLinhas',
      label: 'Itens',
      align: 'right',
      sortValue: (c) => c.numLinhas,
      render: (c) => <span className="text-slate-500">{fmt(c.numLinhas)}</span>,
    },
    { key: 'distribuidor', label: 'Distribuidor', sortValue: (c) => c.distribuidor, render: (c) => c.distribuidor },
    { key: 'cliente', label: 'Cliente', sortValue: (c) => c.cliente, render: (c) => <span className="text-xs">{c.cliente}</span> },
    {
      key: 'subTipoProdutoPrincipal',
      label: 'Mourão/Peças predominante',
      sortValue: (c) => c.subTipoProdutoPrincipal,
      render: (c) => (
        <span>
          {c.subTipoProdutoPrincipal} <span className="text-xs text-slate-400">({c.tipoProdutoPrincipal})</span>
        </span>
      ),
    },
    { key: 'tabelaPreco', label: 'ICMS', sortValue: (c) => c.tabelaPreco, render: (c) => c.tabelaPreco },
    { key: 'm3Total', label: 'm³', align: 'right', sortValue: (c) => c.m3Total, render: (c) => fmt(c.m3Total, 1) },
    { key: 'valorM3', label: 'R$/m³', align: 'right', sortValue: (c) => c.valorM3 ?? 0, render: (c) => fmtMoeda(c.valorM3) },
    { key: 'precoPonderado', label: 'Meta de destino', align: 'right', sortValue: (c) => c.precoPonderado ?? 0, render: (c) => fmtMoeda(c.precoPonderado) },
    {
      key: 'margem',
      label: 'Margem vs mínimo',
      align: 'right',
      sortValue: (c) => (c.valorM3 ?? 0) - (c.precoPonderado ?? 0),
      render: (c) => {
        const margem = (c.valorM3 ?? 0) - (c.precoPonderado ?? 0)
        return (
          <span className={margem >= 0 ? 'font-medium text-emerald-700' : 'font-medium text-red-700'}>{fmtMoeda(margem)}</span>
        )
      },
    },
  ]
}

/**
 * Detalhe expansível de uma carga — pedido do usuário 2026-08-04: "nas
 * melhores cargas precisa abrir para ver o detalhe, qual a carga e quais
 * produtos". Ajustado no mesmo dia: agrupado por NF individual (não só o
 * total por produto da carga inteira) — "veja que mostram 10 cargas
 * [NFs], preciso saber individual pois não cabe na carga todos estes
 * produtos". Uma carga com mais de 2 NFs foge do padrão RodoTrem/
 * Rodocaçamba (que sempre são exatamente 2) e pode ser, na verdade, várias
 * entregas distintas da mesma placa no mesmo dia — não uma carga física
 * única.
 */
function renderCargaExpandida(c: Carga) {
  return (
    <div className="space-y-3">
      {c.notas.length > 2 && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
          Esta "carga" junta {c.notas.length} NFs da mesma placa/dia — mais que as 2 esperadas de
          RodoTrem/Rodocaçamba. Pode ser que sejam entregas distintas no mesmo dia, não uma carga física
          única — confira NF a NF abaixo.
        </p>
      )}
      {c.notas.map((n) => (
        <div key={n.numeroMov} className="rounded-lg border border-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-2 py-1.5 text-xs">
            <span className="font-medium">
              NF {n.numeroMov || '—'} <span className="font-normal text-slate-500">— {n.cliente}</span>
            </span>
            <span className="text-slate-500">
              {fmt(n.m3Total, 2)} m³ — {fmtMoeda(n.faturamentoBruto)}
            </span>
          </div>
          <table className="w-full text-xs">
            <thead className="text-left text-slate-500">
              <tr>
                <th className="px-2 py-1">Produto</th>
                <th className="px-2 py-1 text-right">Quantidade</th>
                <th className="px-2 py-1 text-right">m³</th>
                <th className="px-2 py-1 text-right">Valor</th>
              </tr>
            </thead>
            <tbody>
              {n.produtos.map((p) => (
                <tr key={p.produto} className="border-t border-slate-100">
                  <td className="px-2 py-1">{p.produto}</td>
                  <td className="px-2 py-1 text-right">{fmt(p.quantidade, 2)}</td>
                  <td className="px-2 py-1 text-right">{fmt(p.m3Total, 2)}</td>
                  <td className="px-2 py-1 text-right">{fmtMoeda(p.valorBruto)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}

/**
 * Melhor carga — pedido do usuário 2026-08-04: "montar uma análise
 * estratégica de qual a melhor carga, com melhor preço por m³ ponderado
 * entre mourão e peças de acordo com as alíquotas de ICMS, quero entender
 * qual a minha melhor venda". Cada "carga" junta as notas da mesma placa no
 * mesmo dia (RodoTrem/Rodocaçamba exigem 2 NFs) e é ranqueada pela margem
 * (R$/m³ realizado − mínimo ponderado daquela carga).
 *
 * Mourão x Peças usa `SubTipoProduto` (implementado só depois, na releitura
 * da nota original em 2026-08-04) — "Peças" é qualquer produto Agronegócio
 * que NÃO tenha "2,20" no nome, não uma palavra literal no produto. Antes
 * disso a comparação não funcionava porque essa coluna nunca tinha sido
 * implementada.
 */
export function MelhorCargaTab() {
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(todayStr())
  const [data, setData] = useState<MelhorCargaData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/fase3/melhor-carga?from=${from}&to=${to}`)
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false))
  }, [from, to])

  const colunasResumo: SortableColumn<ResumoTipoTabela>[] = [
    { key: 'subTipoProduto', label: 'Mourão / Peças', sortValue: (r) => r.subTipoProduto, render: (r) => <span className="font-medium">{r.subTipoProduto}</span> },
    { key: 'tabelaPreco', label: 'ICMS', sortValue: (r) => r.tabelaPreco, render: (r) => r.tabelaPreco },
    { key: 'n', label: 'Cargas', align: 'right', sortValue: (r) => r.n, render: (r) => fmt(r.n) },
    { key: 'm3Total', label: 'm³ total', align: 'right', sortValue: (r) => r.m3Total, render: (r) => fmt(r.m3Total, 1) },
    { key: 'valorM3Medio', label: 'R$/m³ médio ponderado', align: 'right', sortValue: (r) => r.valorM3Medio ?? 0, render: (r) => fmtMoeda(r.valorM3Medio) },
    { key: 'precoPonderado', label: 'Meta de destino', align: 'right', sortValue: (r) => r.precoPonderado ?? 0, render: (r) => fmtMoeda(r.precoPonderado) },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <DateRangeInputs from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
        {loading && <span className="text-xs text-slate-500">carregando…</span>}
        {data?.period && (
          <span className="text-xs text-slate-500">
            Período: {fmtDateBR(data.period.from)} a {fmtDateBR(data.period.to)}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">Cargas no período</p>
          <p className="text-lg font-semibold">{fmt(data?.totalCargas ?? 0)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">Cargas com 2+ notas (RodoTrem/Rodocaçamba)</p>
          <p className="text-lg font-semibold">{fmt(data?.cargasComMultiplasNotas ?? 0)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">Linhas sem placa (fora da análise)</p>
          <p className="text-lg font-semibold">{fmt(data?.linhasSemPlaca ?? 0)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">m³ mínimo por carga considerado</p>
          <p className="text-lg font-semibold">{fmt(data?.m3MinimoCarga ?? 0)} m³</p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3 font-medium">
          Preço por m³ ponderado — Mourão x Peças × alíquota de ICMS
        </div>
        <SortableTable columns={colunasResumo} rows={data?.resumoPorTipoTabela ?? []} rowKey={(r) => `${r.subTipoProduto}|${r.tabelaPreco}`} defaultSortKey="valorM3Medio" />
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3 font-medium">Melhores cargas (top 20 por margem vs mínimo)</div>
        <SortableTable
          columns={colunasCarga()}
          rows={data?.melhoresCargas ?? []}
          rowKey={(c) => c.chave}
          defaultSortKey="margem"
          renderExpanded={renderCargaExpandida}
        />
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3 font-medium">Piores cargas (top 20 por margem vs mínimo)</div>
        <SortableTable
          columns={colunasCarga()}
          rows={data?.pioresCargas ?? []}
          rowKey={(c) => c.chave}
          defaultSortKey="margem"
          defaultSortDir="asc"
          renderExpanded={renderCargaExpandida}
        />
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3 font-medium">
          Direcionamento por cliente — melhor carga real de cada cliente
          <span className="ml-2 text-xs font-normal text-slate-500">
            pedido do usuário 2026-08-04: "preciso de um direcionamento para o cliente quando tiver dúvida" — quando
            esse cliente ficar em dúvida do que comprar, esta é a carga real dele com melhor margem, para replicar
          </span>
        </div>
        <SortableTable
          columns={
            [
              { key: 'cliente', label: 'Cliente', sortValue: (d) => d.cliente, render: (d) => <span className="font-medium">{d.cliente}</span> },
              { key: 'numCargas', label: 'Cargas no período', align: 'right', sortValue: (d) => d.numCargas, render: (d) => fmt(d.numCargas) },
              { key: 'data', label: 'Data da melhor carga', sortValue: (d) => d.melhorCarga.data, render: (d) => fmtDateBR(d.melhorCarga.data) },
              {
                key: 'subTipoProduto',
                label: 'Mourão/Peças predominante',
                sortValue: (d) => d.melhorCarga.subTipoProdutoPrincipal,
                render: (d) => d.melhorCarga.subTipoProdutoPrincipal,
              },
              { key: 'valorM3', label: 'R$/m³', align: 'right', sortValue: (d) => d.melhorCarga.valorM3 ?? 0, render: (d) => fmtMoeda(d.melhorCarga.valorM3) },
              {
                key: 'margem',
                label: 'Margem vs mínimo',
                align: 'right',
                sortValue: (d) => (d.melhorCarga.valorM3 ?? 0) - (d.melhorCarga.precoPonderado ?? 0),
                render: (d) => {
                  const margem = (d.melhorCarga.valorM3 ?? 0) - (d.melhorCarga.precoPonderado ?? 0)
                  return <span className={margem >= 0 ? 'font-medium text-emerald-700' : 'font-medium text-red-700'}>{fmtMoeda(margem)}</span>
                },
              },
            ] as SortableColumn<DirecionamentoCliente>[]
          }
          rows={data?.direcionamentoPorCliente ?? []}
          rowKey={(d) => d.cliente}
          defaultSortKey="margem"
          renderExpanded={(d) => renderCargaExpandida(d.melhorCarga)}
          emptyMessage="Nenhuma carga relevante no período para os clientes selecionados."
        />
      </div>
    </div>
  )
}
