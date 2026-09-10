'use client'

import { useEffect, useState } from 'react'
import { DateRangeInputs, fmtDateBR } from '@/components/shared/DateRangeInputs'
import { SortableTable, type SortableColumn } from '@/components/shared/SortableTable'

interface NotaOrigem {
  numeroMov: string
  data: string
  tipoMovimento: 'Vendas' | 'Devolucoes' | 'Bonificacoes'
}
interface NotaDevolucao {
  numeroMov: string
  data: string
}
interface ItemConferencia {
  codigoPrd: string
  produto: string
  quantidadeOrigem: number
  quantidadeDevolvida: number
  diferencaQuantidade: number
  valorOrigem: number
  valorDevolvido: number
  diferencaValor: number
  m3Origem: number
  m3Devolvido: number
  ok: boolean
}
interface GrupoConferencia {
  idMov: string
  distribuidor: string
  cliente: string
  notasOrigem: NotaOrigem[]
  notasDevolucao: NotaDevolucao[]
  itens: ItemConferencia[]
  valorOrigemTotal: number
  valorDevolvidoTotal: number
  ok: boolean
}
interface DevolucaoSemOrigem {
  numeroMov: string
  data: string
  distribuidor: string
  cliente: string
  produto: string
  quantidade: number
  valorBruto: number
  idMovRelac: string
}

interface ApiData {
  period: { from: string; to: string }
  resumo: {
    gruposOk: number
    gruposDivergentes: number
    semOrigem: number
    valorSemOrigem: number
  }
  grupos: GrupoConferencia[]
  semOrigem: DevolucaoSemOrigem[]
}

function fmtMoeda(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 })
}
function fmt(n: number, digits = 2): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: digits })
}
function monthStart(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}
function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function rotuloTipo(tipo: NotaOrigem['tipoMovimento']): string {
  return tipo === 'Bonificacoes' ? 'Bonificação' : tipo === 'Devolucoes' ? 'Devolução' : 'Venda'
}

/**
 * Conferência de devoluções — pedido do usuário 2026-09-09: "vamos agrupar
 * as notas para que possamos confirmar que o valor esta zerando e quando os
 * quantitativos e/ou valores forem diferentes podermos validar os numeros".
 * Cada grupo liga a nota de venda/bonificação à(s) devolução(ões) que a
 * revertem (via TMOV.IDMOVRELAC), comparando quantidade e valor bruto
 * produto a produto — "ok" só quando os dois lados batem em TODO produto.
 */
export function ConferenciaDevolucoesTab() {
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(todayStr())
  const [data, setData] = useState<ApiData | null>(null)
  const [loading, setLoading] = useState(true)
  const [somenteDivergentes, setSomenteDivergentes] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/fase3/conferencia-devolucoes?from=${from}&to=${to}`)
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false))
  }, [from, to])

  const grupos = data?.grupos ?? []
  const gruposVisiveis = somenteDivergentes ? grupos.filter((g) => !g.ok) : grupos

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

      <p className="text-sm text-slate-500">
        Cada grupo liga a venda ou bonificação à(s) devolução(ões) que a revertem (TMOV.IDMOVRELAC), comparando
        quantidade e valor bruto produto a produto. <strong>OK</strong> = os dois lados batem em todo produto;{' '}
        <strong>Divergente</strong> = sobrou diferença de quantidade e/ou valor para validar manualmente.
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-xs text-emerald-700">Grupos OK (zeraram)</p>
          <p className="font-semibold text-emerald-800">{data?.resumo.gruposOk ?? 0}</p>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs text-amber-700">Grupos divergentes</p>
          <p className="font-semibold text-amber-800">{data?.resumo.gruposDivergentes ?? 0}</p>
        </div>
        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-xs text-red-700">Devoluções sem origem encontrada</p>
          <p className="font-semibold text-red-800">{data?.resumo.semOrigem ?? 0}</p>
        </div>
        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-xs text-red-700">Valor sem origem encontrada</p>
          <p className="font-semibold text-red-800">{fmtMoeda(data?.resumo.valorSemOrigem ?? 0)}</p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <span className="font-medium">Venda/bonificação × devolução ({gruposVisiveis.length})</span>
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={somenteDivergentes} onChange={(e) => setSomenteDivergentes(e.target.checked)} />
            Mostrar só divergentes
          </label>
        </div>
        <SortableTable
          columns={
            [
              {
                key: 'situacao',
                label: 'Situação',
                sortValue: (g) => (g.ok ? 1 : 0),
                render: (g) =>
                  g.ok ? (
                    <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">OK — zerou</span>
                  ) : (
                    <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Divergente</span>
                  ),
              },
              {
                key: 'notasOrigem',
                label: 'Nota(s) de origem',
                sortValue: (g) => g.notasOrigem.map((n) => n.numeroMov).join(','),
                render: (g) => (
                  <div className="space-y-0.5">
                    {g.notasOrigem.map((n) => (
                      <div key={n.numeroMov} className="whitespace-nowrap">
                        <span className="font-medium">{n.numeroMov || '—'}</span>{' '}
                        <span className="text-xs text-slate-500">
                          ({rotuloTipo(n.tipoMovimento)}, {fmtDateBR(n.data)})
                        </span>
                      </div>
                    ))}
                  </div>
                ),
              },
              {
                key: 'notasDevolucao',
                label: 'Nota(s) de devolução',
                sortValue: (g) => g.notasDevolucao.map((n) => n.numeroMov).join(','),
                render: (g) => (
                  <div className="space-y-0.5">
                    {g.notasDevolucao.map((n) => (
                      <div key={n.numeroMov} className="whitespace-nowrap">
                        <span className="font-medium">{n.numeroMov || '—'}</span>{' '}
                        <span className="text-xs text-slate-500">({fmtDateBR(n.data)})</span>
                      </div>
                    ))}
                  </div>
                ),
              },
              { key: 'distribuidor', label: 'Distribuidor', sortValue: (g) => g.distribuidor, render: (g) => g.distribuidor },
              { key: 'cliente', label: 'Cliente', sortValue: (g) => g.cliente, render: (g) => g.cliente },
              { key: 'valorOrigemTotal', label: 'Valor origem', align: 'right', sortValue: (g) => g.valorOrigemTotal, render: (g) => fmtMoeda(g.valorOrigemTotal) },
              { key: 'valorDevolvidoTotal', label: 'Valor devolvido', align: 'right', sortValue: (g) => g.valorDevolvidoTotal, render: (g) => fmtMoeda(g.valorDevolvidoTotal) },
              {
                key: 'diferenca',
                label: 'Diferença',
                align: 'right',
                sortValue: (g) => Math.abs(g.valorOrigemTotal - g.valorDevolvidoTotal),
                render: (g) => {
                  const diff = g.valorOrigemTotal - g.valorDevolvidoTotal
                  return <span className={!g.ok ? 'font-medium text-amber-800' : ''}>{fmtMoeda(diff)}</span>
                },
              },
            ] as SortableColumn<GrupoConferencia>[]
          }
          rows={gruposVisiveis}
          rowKey={(g) => g.idMov}
          defaultSortKey="situacao"
          defaultSortDir="asc"
          renderExpanded={(g) => (
            <table className="w-full text-xs">
              <thead className="text-left text-slate-500">
                <tr>
                  <th className="py-1 pl-2">Produto</th>
                  <th className="py-1 text-right">Qtd origem</th>
                  <th className="py-1 text-right">Qtd devolvida</th>
                  <th className="py-1 text-right">Dif. qtd</th>
                  <th className="py-1 text-right">Valor origem</th>
                  <th className="py-1 text-right">Valor devolvido</th>
                  <th className="py-1 text-right">Dif. valor</th>
                  <th className="py-1 text-center">Situação</th>
                </tr>
              </thead>
              <tbody>
                {g.itens.map((it) => (
                  <tr key={it.codigoPrd} className={`border-t border-slate-100 ${!it.ok ? 'bg-amber-50' : ''}`}>
                    <td className="py-1 pl-2">{it.produto}</td>
                    <td className="py-1 text-right">{fmt(it.quantidadeOrigem)}</td>
                    <td className="py-1 text-right">{fmt(it.quantidadeDevolvida)}</td>
                    <td className="py-1 text-right">{fmt(it.diferencaQuantidade)}</td>
                    <td className="py-1 text-right">{fmtMoeda(it.valorOrigem)}</td>
                    <td className="py-1 text-right">{fmtMoeda(it.valorDevolvido)}</td>
                    <td className="py-1 text-right">{fmtMoeda(it.diferencaValor)}</td>
                    <td className="py-1 text-center">
                      {it.ok ? (
                        <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-800">OK</span>
                      ) : (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800">Divergente</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          emptyMessage={somenteDivergentes ? 'Nenhum grupo divergente no período.' : 'Nenhuma venda/bonificação com devolução vinculada no período.'}
        />
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3 font-medium">
          Devoluções sem origem encontrada ({data?.semOrigem.length ?? 0})
        </div>
        <p className="px-4 pt-2 text-xs text-slate-500">
          IDMOVRELAC vazio, ou a nota de origem caiu fora do período selecionado — sem a origem carregada não dá para
          confirmar que a devolução zerou. Amplie o período ou confira direto no ERP.
        </p>
        <SortableTable
          columns={
            [
              { key: 'numeroMov', label: 'NF devolução', sortValue: (d) => d.numeroMov, render: (d) => <span className="font-medium">{d.numeroMov || '—'}</span> },
              { key: 'data', label: 'Data', sortValue: (d) => d.data, render: (d) => fmtDateBR(d.data) },
              { key: 'distribuidor', label: 'Distribuidor', sortValue: (d) => d.distribuidor, render: (d) => d.distribuidor },
              { key: 'cliente', label: 'Cliente', sortValue: (d) => d.cliente, render: (d) => d.cliente },
              { key: 'produto', label: 'Produto', sortValue: (d) => d.produto, render: (d) => <span className="text-xs">{d.produto}</span> },
              { key: 'quantidade', label: 'Quantidade', align: 'right', sortValue: (d) => d.quantidade, render: (d) => fmt(d.quantidade) },
              { key: 'valorBruto', label: 'Valor bruto', align: 'right', sortValue: (d) => d.valorBruto, render: (d) => fmtMoeda(d.valorBruto) },
              { key: 'idMovRelac', label: 'IDMOVRELAC', sortValue: (d) => d.idMovRelac, render: (d) => <span className="font-mono text-xs">{d.idMovRelac || '—'}</span> },
            ] as SortableColumn<DevolucaoSemOrigem>[]
          }
          rows={data?.semOrigem ?? []}
          rowKey={(d, i) => `${d.numeroMov}-${i}`}
          defaultSortKey="valorBruto"
          emptyMessage="Nenhuma devolução sem origem no período."
        />
      </div>
    </div>
  )
}
