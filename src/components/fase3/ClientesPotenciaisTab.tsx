'use client'

import { useEffect, useState } from 'react'
import { CategoriaFiltro, CATEGORIA_PADRAO } from './CategoriaFiltro'
import { SortableTable, type SortableColumn } from '@/components/shared/SortableTable'

type StatusAcao = 'FAZER_CONTATO' | 'NEGATIVADO' | 'SEM_INTERESSE' | 'ENCERROU_ATIVIDADE'

const STATUS_LABEL: Record<StatusAcao, string> = {
  FAZER_CONTATO: 'Fazer contato',
  NEGATIVADO: 'Cliente negativado',
  SEM_INTERESSE: 'Não tem interesse',
  ENCERROU_ATIVIDADE: 'Encerrou atividade',
}
const STATUS_COR: Record<StatusAcao, string> = {
  FAZER_CONTATO: 'bg-emerald-100 text-emerald-800',
  NEGATIVADO: 'bg-red-100 text-red-800',
  SEM_INTERESSE: 'bg-slate-200 text-slate-700',
  ENCERROU_ATIVIDADE: 'bg-slate-300 text-slate-800',
}

interface ClientePotencial {
  cliente: string
  mesesComCompra: number
  ultimoMes: string
  faturamentoTotal: number
  mesesSemComprar: number
  distribuidor: string
  email: string
  telefone: string
  cidade: string
  codetd: string
  status: StatusAcao | null
  observacao: string | null
  historicoMensal: { mes: string; faturamento: number }[]
}

interface ClientesPotenciaisData {
  mesReferencia: string
  categoriasDisponiveis: string[]
  porCategoria: { chave: string; faturamentoLiquido: number; m3Total: number }[]
  totalInativos: number
  faturamentoTotalEmRisco: number
  clientes: ClientePotencial[]
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

function StatusBadge({ status }: { status: StatusAcao | null }) {
  if (!status) return <span className="text-xs text-slate-400">—</span>
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_COR[status]}`}>{STATUS_LABEL[status]}</span>
}

function renderClienteExpandido(c: ClientePotencial, onStatusChange: (cliente: string, status: string) => void) {
  const meses = c.historicoMensal
  const maiorMes = meses.length ? Math.max(...meses.map((m) => m.faturamento)) : 0
  return (
    <div className="space-y-3 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-xs text-slate-500">Ação:</label>
        <select
          className="rounded-md border border-slate-300 px-2 py-1 text-xs"
          value={c.status ?? ''}
          onChange={(e) => onStatusChange(c.cliente, e.target.value)}
        >
          <option value="">— sem marcação —</option>
          {(Object.keys(STATUS_LABEL) as StatusAcao[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        {c.email !== '—' && <span className="text-xs text-slate-500">{c.email}</span>}
        {c.telefone !== '—' && <span className="text-xs text-slate-500">{c.telefone}</span>}
      </div>
      {meses.length > 0 ? (
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
      ) : (
        <p className="text-xs text-slate-500">Sem histórico mensal.</p>
      )}
    </div>
  )
}

/**
 * Clientes potenciais (prospecção/win-back) — pedido original da nota Fase 3,
 * implementado 2026-08-04: "clientes que eram compradores e deixaram de
 * comprar do início do negócio para cá... por nível de relevância".
 * Melhorado em 2026-08-05: layout com filtro por status, detalhe mensal
 * expansível por cliente, e seletor de ação (fazer contato / negativado /
 * sem interesse / encerrou atividade) persistido por cliente.
 */
export function ClientesPotenciaisTab() {
  const [categorias, setCategorias] = useState<string[]>([CATEGORIA_PADRAO])
  const [data, setData] = useState<ClientesPotenciaisData | null>(null)
  const [loading, setLoading] = useState(true)
  const [filtroStatus, setFiltroStatus] = useState<StatusAcao | 'todos' | 'semStatus'>('todos')

  function carregar() {
    setLoading(true)
    fetch(`/api/fase3/clientes-potenciais?categorias=${encodeURIComponent(categorias.join(','))}`)
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false))
  }

  useEffect(carregar, [categorias])

  async function onStatusChange(cliente: string, status: string) {
    setData((prev) =>
      prev ? { ...prev, clientes: prev.clientes.map((c) => (c.cliente === cliente ? { ...c, status: (status || null) as StatusAcao | null } : c)) } : prev,
    )
    await fetch('/api/fase3/clientes-potenciais/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cliente, status }),
    })
  }

  const clientesFiltrados = (data?.clientes ?? []).filter((c) => {
    if (filtroStatus === 'todos') return true
    if (filtroStatus === 'semStatus') return !c.status
    return c.status === filtroStatus
  })

  const contagemPorStatus = (Object.keys(STATUS_LABEL) as StatusAcao[]).reduce(
    (acc, s) => ({ ...acc, [s]: (data?.clientes ?? []).filter((c) => c.status === s).length }),
    {} as Record<StatusAcao, number>,
  )
  const semStatus = (data?.clientes ?? []).filter((c) => !c.status).length

  function colunas(): SortableColumn<ClientePotencial>[] {
    return [
      { key: 'cliente', label: 'Cliente', sortValue: (c) => c.cliente, render: (c) => <span className="font-medium">{c.cliente}</span> },
      { key: 'status', label: 'Ação', sortValue: (c) => c.status ?? '', render: (c) => <StatusBadge status={c.status} /> },
      { key: 'cidade', label: 'Cidade/UF', sortValue: (c) => c.cidade, render: (c) => `${c.cidade}${c.codetd && c.codetd !== '—' ? '/' + c.codetd : ''}` },
      { key: 'distribuidor', label: 'Distribuidor', sortValue: (c) => c.distribuidor, render: (c) => c.distribuidor },
      { key: 'ultimoMes', label: 'Última compra', sortValue: (c) => c.ultimoMes, render: (c) => fmtMes(c.ultimoMes) },
      { key: 'mesesSemComprar', label: 'Meses sem comprar', align: 'right', sortValue: (c) => c.mesesSemComprar, render: (c) => fmt(c.mesesSemComprar) },
      { key: 'mesesComCompra', label: 'Meses ativos (histórico)', align: 'right', sortValue: (c) => c.mesesComCompra, render: (c) => fmt(c.mesesComCompra) },
      { key: 'faturamentoTotal', label: 'Faturamento histórico', align: 'right', sortValue: (c) => c.faturamentoTotal, render: (c) => fmtMoeda(c.faturamentoTotal) },
    ]
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        Clientes que já compraram em algum momento desde o início do negócio (2022) mas estão há 6+ meses sem
        comprar — ordenados pelo faturamento histórico (relevância), para priorizar quem vale mais a pena
        reativar primeiro. Clique numa linha para ver o histórico mês a mês e marcar uma ação.
      </div>

      <CategoriaFiltro
        categoriasDisponiveis={data?.categoriasDisponiveis ?? []}
        porCategoria={data?.porCategoria ?? []}
        selecionadas={categorias}
        onChange={setCategorias}
      />

      {loading && <span className="text-xs text-slate-500">carregando…</span>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <button
          type="button"
          onClick={() => setFiltroStatus('todos')}
          className={`rounded-xl border p-3 text-left transition-shadow ${filtroStatus === 'todos' ? 'border-slate-400 ring-2 ring-slate-400' : 'border-slate-200 hover:shadow-sm'} bg-white`}
        >
          <p className="text-xs text-slate-500">Todos</p>
          <p className="text-lg font-semibold">{fmt(data?.totalInativos ?? 0)}</p>
        </button>
        <button
          type="button"
          onClick={() => setFiltroStatus('semStatus')}
          className={`rounded-xl border p-3 text-left transition-shadow ${filtroStatus === 'semStatus' ? 'border-slate-400 ring-2 ring-slate-400' : 'border-slate-200 hover:shadow-sm'} bg-white`}
        >
          <p className="text-xs text-slate-500">Sem marcação</p>
          <p className="text-lg font-semibold">{fmt(semStatus)}</p>
        </button>
        {(Object.keys(STATUS_LABEL) as StatusAcao[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFiltroStatus(s)}
            className={`rounded-xl border p-3 text-left transition-shadow ${filtroStatus === s ? 'ring-2 ring-emerald-600' : 'hover:shadow-sm'} border-slate-200 bg-white`}
          >
            <p className="text-xs text-slate-500">{STATUS_LABEL[s]}</p>
            <p className="text-lg font-semibold">{fmt(contagemPorStatus[s] ?? 0)}</p>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-xs text-amber-800">Faturamento histórico em risco</p>
          <p className="text-lg font-semibold text-amber-900">{fmtMoeda(data?.faturamentoTotalEmRisco ?? 0)}</p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3 font-medium">
          Clientes potenciais para prospecção ({clientesFiltrados.length})
        </div>
        <SortableTable
          columns={colunas()}
          rows={clientesFiltrados}
          rowKey={(c) => c.cliente}
          defaultSortKey="faturamentoTotal"
          emptyMessage="Nenhum cliente no filtro atual."
          renderExpanded={(c) => renderClienteExpandido(c, onStatusChange)}
        />
      </div>
    </div>
  )
}
