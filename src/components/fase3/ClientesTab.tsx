'use client'

import { useEffect, useState } from 'react'
import { CategoriaFiltro, CATEGORIA_PADRAO } from './CategoriaFiltro'
import { SortableTable, type SortableColumn } from '@/components/shared/SortableTable'

interface ClienteHistorico {
  cliente: string
  mesesComCompra: number
  ultimoMes: string
  faturamentoTotal: number
  recorrente: boolean
  parado: boolean
  emQueda: boolean
  faturamentoUltimos3Meses: number
  faturamentoAnteriores3Meses: number
  historicoMensal: { mes: string; faturamento: number }[]
}

interface ClientesData {
  mesReferencia: string
  categoriasDisponiveis: string[]
  porCategoria: { chave: string; faturamentoLiquido: number; m3Total: number }[]
  totalClientes: number
  clientesRecorrentes: number
  clientesParados: ClienteHistorico[]
  clientesEmQueda: ClienteHistorico[]
  todosClientes: ClienteHistorico[]
}

function fmt(n: number, digits = 0): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: digits })
}
function fmtMoeda(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 })
}
function fmtMes(iso: string): string {
  const [ano, mes] = iso.split('-')
  if (!ano || !mes) return iso
  return `${mes}/${ano}`
}

function colunas(): SortableColumn<ClienteHistorico>[] {
  return [
    { key: 'cliente', label: 'Cliente', sortValue: (c) => c.cliente, render: (c) => <span className="font-medium">{c.cliente}</span> },
    { key: 'ultimoMes', label: 'Última compra', sortValue: (c) => c.ultimoMes, render: (c) => fmtMes(c.ultimoMes) },
    { key: 'mesesComCompra', label: 'Meses com compra (total)', align: 'right', sortValue: (c) => c.mesesComCompra, render: (c) => fmt(c.mesesComCompra) },
    { key: 'faturamentoTotal', label: 'Faturamento total', align: 'right', sortValue: (c) => c.faturamentoTotal, render: (c) => fmtMoeda(c.faturamentoTotal) },
    { key: 'faturamentoUltimos3Meses', label: 'Últimos 3 meses', align: 'right', sortValue: (c) => c.faturamentoUltimos3Meses, render: (c) => fmtMoeda(c.faturamentoUltimos3Meses) },
    { key: 'faturamentoAnteriores3Meses', label: '3 meses anteriores', align: 'right', sortValue: (c) => c.faturamentoAnteriores3Meses, render: (c) => fmtMoeda(c.faturamentoAnteriores3Meses) },
  ]
}

/**
 * Detalhe expansível de um cliente — pedido do usuário 2026-08-04: "dar a
 * opção de clicar e detalhar melhor o faturamento total em quanto tempo,
 * abrir os meses que estão em comprar e não só a etiqueta de 3 meses".
 * Mostra o período total (primeiro ao último mês) e cada mês com compra,
 * com uma barra simples proporcional ao maior faturamento mensal do
 * cliente para facilitar a leitura visual da tendência.
 */
function renderClienteExpandido(c: ClienteHistorico) {
  const meses = c.historicoMensal
  if (!meses.length) return <p className="p-3 text-xs text-slate-500">Sem histórico mensal.</p>
  const maiorMes = Math.max(...meses.map((m) => m.faturamento))
  const primeiro = meses[0].mes
  const ultimo = meses[meses.length - 1].mes
  return (
    <div className="space-y-2 p-3">
      <p className="text-xs text-slate-500">
        Período de compras: <strong>{fmtMes(primeiro)}</strong> a <strong>{fmtMes(ultimo)}</strong> —{' '}
        {meses.length} {meses.length === 1 ? 'mês com compra' : 'meses com compra'}, faturamento total{' '}
        <strong>{fmtMoeda(c.faturamentoTotal)}</strong>.
      </p>
      <table className="w-full text-xs">
        <thead className="text-left text-slate-500">
          <tr>
            <th className="px-2 py-1">Mês</th>
            <th className="px-2 py-1 text-right">Faturamento</th>
            <th className="px-2 py-1">Proporção</th>
          </tr>
        </thead>
        <tbody>
          {meses.map((m) => (
            <tr key={m.mes} className="border-t border-slate-100">
              <td className="px-2 py-1">{fmtMes(m.mes)}</td>
              <td className="px-2 py-1 text-right">{fmtMoeda(m.faturamento)}</td>
              <td className="px-2 py-1">
                <div className="h-2 rounded bg-emerald-100">
                  <div
                    className="h-2 rounded bg-emerald-500"
                    style={{ width: `${maiorMes > 0 ? Math.max(2, (m.faturamento / maiorMes) * 100) : 0}%` }}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Análise de clientes — pedido original da nota Fase 3, nunca implementado
 * até 2026-08-04: "clientes que tendem a reduzir volume de compra, clientes
 * que tem compras recorrentes e ficaram um tempo sem comprar". Critérios
 * (recorrente = 3+ meses de compra nos últimos 12; parado = recorrente sem
 * comprar há 2+ meses; em queda = últimos 3 meses 30%+ abaixo dos 3
 * anteriores) são um padrão assumido — ver 🔶 decisão pendente na nota Fase 3
 * do Obsidian, ajustar se o critério real for diferente.
 */
type Criterio = 'todos' | 'recorrentes' | 'parados' | 'emQueda'

const CRITERIO_LABEL: Record<Criterio, string> = {
  todos: 'Todos os clientes',
  recorrentes: 'Recorrentes',
  parados: 'Recorrentes parados',
  emQueda: 'Em queda de volume',
}

export function ClientesTab() {
  const [categorias, setCategorias] = useState<string[]>([CATEGORIA_PADRAO])
  const [data, setData] = useState<ClientesData | null>(null)
  const [loading, setLoading] = useState(true)
  const [criterio, setCriterio] = useState<Criterio>('todos')

  useEffect(() => {
    setLoading(true)
    fetch(`/api/fase3/clientes?categorias=${encodeURIComponent(categorias.join(','))}`)
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false))
  }, [categorias])

  // Filtro clicável por critério — pedido do usuário 2026-08-04: "na aba de
  // clientes, opções de clicar e filtrar os clientes de acordo com o
  // critério". Os cards de KPI abaixo funcionam como botões de filtro.
  const clientesFiltrados = (data?.todosClientes ?? []).filter((c) => {
    if (criterio === 'recorrentes') return c.recorrente
    if (criterio === 'parados') return c.parado
    if (criterio === 'emQueda') return c.emQueda
    return true
  })

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Critérios assumidos (não confirmados com você ainda — ver nota Fase 3 no Obsidian): recorrente = 3+
        meses de compra nos últimos 12; parado = recorrente sem comprar há 2+ meses; em queda = últimos 3
        meses 30%+ abaixo dos 3 meses anteriores. Ajusto assim que você confirmar os números certos.
      </div>

      <CategoriaFiltro
        categoriasDisponiveis={data?.categoriasDisponiveis ?? []}
        porCategoria={data?.porCategoria ?? []}
        selecionadas={categorias}
        onChange={setCategorias}
      />

      {loading && <span className="text-xs text-slate-500">carregando…</span>}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {(
          [
            ['todos', data?.totalClientes ?? 0, 'border-slate-200 bg-white', 'text-slate-500', ''],
            ['recorrentes', data?.clientesRecorrentes ?? 0, 'border-slate-200 bg-white', 'text-slate-500', ''],
            ['parados', data?.clientesParados.length ?? 0, 'border-red-200 bg-red-50', 'text-red-700', 'text-red-800'],
            ['emQueda', data?.clientesEmQueda.length ?? 0, 'border-amber-200 bg-amber-50', 'text-amber-700', 'text-amber-800'],
          ] as [Criterio, number, string, string, string][]
        ).map(([c, valor, bg, labelCls, valorCls]) => (
          <button
            key={c}
            type="button"
            onClick={() => setCriterio(c)}
            className={`rounded-xl border p-4 text-left transition-shadow ${bg} ${criterio === c ? 'ring-2 ring-emerald-600' : 'hover:shadow-sm'}`}
          >
            <p className={`text-xs ${labelCls}`}>{CRITERIO_LABEL[c]}</p>
            <p className={`text-lg font-semibold ${valorCls}`}>{fmt(valor)}</p>
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3 font-medium">
          {CRITERIO_LABEL[criterio]} ({clientesFiltrados.length})
        </div>
        <SortableTable
          columns={colunas()}
          rows={clientesFiltrados}
          rowKey={(c) => c.cliente}
          defaultSortKey="faturamentoTotal"
          emptyMessage="Nenhum cliente no critério selecionado."
          renderExpanded={renderClienteExpandido}
        />
      </div>
    </div>
  )
}
