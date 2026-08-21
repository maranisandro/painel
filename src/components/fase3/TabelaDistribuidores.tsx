'use client'

import { Fragment, useState } from 'react'
import { SortableTable, type SortableColumn } from '@/components/shared/SortableTable'

interface VendaAgregada {
  chave: string
  faturamentoLiquido: number
  vendasUN: number
  m3Total: number
  valorM3Vendido: number | null
  precoPonderado: number | null
  abaixoDoMinimo: boolean
  perdaEstimada: number
}

interface DistribuidorCliente extends VendaAgregada {
  distribuidor: string
  cliente: string
}

interface DistribuidorClienteProduto extends VendaAgregada {
  distribuidor: string
  cliente: string
  produto: string
}

function fmt(n: number | null, digits = 0): string {
  if (n == null) return '—'
  return n.toLocaleString('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: digits })
}
function fmtMoeda(n: number | null): string {
  if (n == null) return '—'
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 })
}

/** % abaixo do mínimo ponderado — pedido do usuário 2026-08-04: "no painel mensal, clientes abaixo do mínimo, colocar o % abaixo" (só o rótulo "abaixo do mínimo" não dizia o quanto). */
function percAbaixo(v: VendaAgregada): number | null {
  if (v.valorM3Vendido == null || v.precoPonderado == null || v.precoPonderado === 0) return null
  return ((v.precoPonderado - v.valorM3Vendido) / v.precoPonderado) * 100
}

function SituacaoBadge({ v }: { v: VendaAgregada }) {
  if (v.valorM3Vendido == null) return <span className="text-slate-400">sem m³</span>
  if (!v.abaixoDoMinimo) return <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">dentro do mínimo</span>
  const perc = percAbaixo(v)
  return (
    <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
      abaixo do mínimo{perc != null ? ` (${perc.toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%)` : ''}
    </span>
  )
}

/**
 * Tabela "Por distribuidor" com clientes expansíveis por linha (pedido do
 * usuário 2026-08-04: "fazer uma opção de abrir clientes por distribuidor,
 * assim podemos inclusive saber quais os distribuidores estão sem
 * cliente") — compartilhada entre a análise por período (Fase3Dashboard) e
 * o painel estratégico anual (PainelEstrategico). Distribuidores conhecidos
 * (`DISTRIBUIDORES_CONHECIDOS`) sem nenhuma linha no recorte aparecem no
 * aviso abaixo da tabela em vez de sumir silenciosamente. Cada cliente, por
 * sua vez, abre para mostrar os produtos que mais pesam na perda (pedido do
 * usuário: "quando estiver abaixo da meta, detalhar para sabermos qual
 * produto impacta na meta... colocar os produtos com maior perda").
 */
export function TabelaDistribuidores({
  titulo,
  porDistribuidor,
  porDistribuidorCliente,
  porDistribuidorClienteProduto,
  distribuidoresSemVenda,
}: {
  titulo: string
  porDistribuidor: VendaAgregada[]
  porDistribuidorCliente: DistribuidorCliente[]
  porDistribuidorClienteProduto?: DistribuidorClienteProduto[]
  distribuidoresSemVenda: string[]
}) {
  const [clientesAbertos, setClientesAbertos] = useState<Set<string>>(new Set())

  function toggleCliente(chave: string) {
    setClientesAbertos((prev) => {
      const next = new Set(prev)
      if (next.has(chave)) next.delete(chave)
      else next.add(chave)
      return next
    })
  }

  const clientesPorDistribuidor = new Map<string, DistribuidorCliente[]>()
  for (const c of porDistribuidorCliente) {
    const lista = clientesPorDistribuidor.get(c.distribuidor) ?? []
    lista.push(c)
    clientesPorDistribuidor.set(c.distribuidor, lista)
  }

  const produtosPorClienteChave = new Map<string, DistribuidorClienteProduto[]>()
  for (const p of porDistribuidorClienteProduto ?? []) {
    const chave = `${p.distribuidor}|${p.cliente}`
    const lista = produtosPorClienteChave.get(chave) ?? []
    lista.push(p)
    produtosPorClienteChave.set(chave, lista)
  }

  const colunas: SortableColumn<VendaAgregada>[] = [
    { key: 'chave', label: 'Distribuidor', sortValue: (d) => d.chave, render: (d) => {
      const clientes = clientesPorDistribuidor.get(d.chave) ?? []
      return (
        <span className="font-medium">
          {d.chave} <span className="text-xs font-normal text-slate-400">({clientes.length} cliente{clientes.length === 1 ? '' : 's'})</span>
        </span>
      )
    } },
    { key: 'faturamentoLiquido', label: 'Faturamento líquido', align: 'right', sortValue: (d) => d.faturamentoLiquido, render: (d) => fmtMoeda(d.faturamentoLiquido) },
    { key: 'vendasUN', label: 'Quantidade (un)', align: 'right', sortValue: (d) => d.vendasUN, render: (d) => fmt(d.vendasUN, 0) },
    { key: 'm3Total', label: 'm³ vendido', align: 'right', sortValue: (d) => d.m3Total, render: (d) => fmt(d.m3Total, 1) },
    { key: 'valorM3Vendido', label: 'R$/m³ vendido', align: 'right', sortValue: (d) => d.valorM3Vendido ?? 0, render: (d) => fmtMoeda(d.valorM3Vendido) },
    { key: 'precoPonderado', label: 'Mínimo ponderado', align: 'right', sortValue: (d) => d.precoPonderado ?? 0, render: (d) => fmtMoeda(d.precoPonderado) },
    { key: 'perdaEstimada', label: 'Perda estimada', align: 'right', sortValue: (d) => d.perdaEstimada, render: (d) => d.perdaEstimada > 0 ? <span className="font-medium text-red-700">{fmtMoeda(d.perdaEstimada)}</span> : <span className="text-slate-400">—</span> },
    { key: 'situacao', label: 'Situação', sortValue: (d) => (d.abaixoDoMinimo ? 0 : 1), render: (d) => <SituacaoBadge v={d} /> },
  ]

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-4 py-3 font-medium">
        {titulo} ({porDistribuidor.length})
      </div>
      <SortableTable
        columns={colunas}
        rows={porDistribuidor}
        rowKey={(d) => d.chave}
        defaultSortKey="faturamentoLiquido"
        emptyMessage="Nenhuma venda no recorte."
        renderExpanded={(d) => {
          const clientes = (clientesPorDistribuidor.get(d.chave) ?? []).sort((a, b) => b.faturamentoLiquido - a.faturamentoLiquido)
          return (
            <table className="w-full text-xs">
              <thead className="text-left text-slate-500">
                <tr>
                  <th className="w-6 py-1" />
                  <th className="py-1 pl-2">Cliente</th>
                  <th className="py-1 text-right">Faturamento líquido</th>
                  <th className="py-1 text-right">R$/m³ vendido (preço médio real)</th>
                  <th className="py-1 text-right">Meta de destino ponderada</th>
                  <th className="py-1">Situação</th>
                </tr>
              </thead>
              <tbody>
                {clientes.map((c) => {
                  const chaveCliente = `${c.distribuidor}|${c.cliente}`
                  const aberta = clientesAbertos.has(chaveCliente)
                  const produtos = (produtosPorClienteChave.get(chaveCliente) ?? [])
                    .filter((p) => p.perdaEstimada > 0)
                    .sort((a, b) => b.perdaEstimada - a.perdaEstimada)
                    .slice(0, 5)
                  return (
                    <Fragment key={chaveCliente}>
                      <tr className="border-t border-slate-200">
                        <td className="py-1">
                          {c.abaixoDoMinimo && produtos.length > 0 && (
                            <button
                              type="button"
                              onClick={() => toggleCliente(chaveCliente)}
                              title={aberta ? 'Recolher produtos' : 'Ver produtos que mais pesam na perda'}
                              className="rounded px-1 text-slate-500 hover:bg-slate-200"
                            >
                              {aberta ? '▾' : '▸'}
                            </button>
                          )}
                        </td>
                        <td className="py-1 pl-2">{c.cliente}</td>
                        <td className="py-1 text-right">{fmtMoeda(c.faturamentoLiquido)}</td>
                        <td className="py-1 text-right">{fmtMoeda(c.valorM3Vendido)}</td>
                        <td className="py-1 text-right">{fmtMoeda(c.precoPonderado)}</td>
                        <td className="py-1">
                          <SituacaoBadge v={c} />
                        </td>
                      </tr>
                      {aberta && (
                        <tr className="border-t border-slate-200 bg-white">
                          <td colSpan={6} className="px-2 py-2">
                            <p className="mb-1 pl-4 text-slate-500">Produtos que mais pesam na perda deste cliente:</p>
                            <table className="w-full">
                              <tbody>
                                {produtos.map((p) => (
                                  <tr key={p.produto} className="border-t border-slate-100">
                                    <td className="py-1 pl-4">{p.produto}</td>
                                    <td className="py-1 text-right">{fmtMoeda(p.valorM3Vendido)}/m³</td>
                                    <td className="py-1 text-right text-red-700">{fmtMoeda(p.perdaEstimada)} perda</td>
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
                {clientes.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-2 pl-6 text-slate-400">
                      Nenhum cliente neste recorte.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )
        }}
      />
      {distribuidoresSemVenda.length > 0 && (
        <div className="border-t border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
          Sem nenhum cliente/venda neste recorte: <strong>{distribuidoresSemVenda.join(', ')}</strong>
        </div>
      )}
    </div>
  )
}
