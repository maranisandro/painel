'use client'

import { useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { DateRangeInputs, fmtDateBR } from '@/components/shared/DateRangeInputs'
import { SortableTable, type SortableColumn } from '@/components/shared/SortableTable'

const COR_NOMINAL = '#b45309'
const COR_TABELA4 = '#475569'

interface DistribuidorResumo {
  distribuidor: string
  n: number
  valorNominal: number
  regraViolada: boolean
}

interface DistribuidorClienteResumo {
  distribuidor: string
  cliente: string
  n: number
  quantidade: number
  valorNominal: number
  diferencaTabela4: number
}

interface LinhaDetalhe {
  data: string
  distribuidor: string
  cliente: string
  produto: string
  quantidade: number
  precoVendido: number
  valorNominal: number
  precoMedioTabela4: number
  diferenca: number
}

interface BonificacaoSemTabela4 {
  data: string
  distribuidor: string
  cliente: string
  produto: string
  quantidade: number
  precoVendido: number
  valorBonificacao: number
}

interface EvolucaoMes {
  mes: string
  nominal: number
  tabela4: number
  transacoes: number
}

interface BonificacoesData {
  period: { from: string; to: string }
  totalNominal: number
  totalTabela4: number
  totalTransacoes: number
  evolucaoMensal: EvolucaoMes[]
  porDistribuidor: DistribuidorResumo[]
  porDistribuidorCliente: DistribuidorClienteResumo[]
  linhasDetalhe: LinhaDetalhe[]
  semTabela4: BonificacaoSemTabela4[]
  totalSemTabela4: number
}

function fmt(n: number, digits = 0): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: digits })
}
function fmtMoeda(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 })
}
function monthStart(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}
function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}
function fmtMes(iso: string): string {
  const [ano, mes] = iso.split('-')
  return `${mes}/${ano}`
}

/**
 * Destino das bonificações por distribuidor/cliente — pedido do usuário
 * 2026-08-04: "marque estas vendas bonificadas e para quais clientes estão
 * indo estas bonificações... crie uma seção para ver o destino de
 * bonificações por distribuidor". Usa `bonificacaoOriginal` no backend, então
 * mostra TODAS as transações originalmente marcadas como bonificação no
 * Oracle — inclusive as da Planep, que contam como venda normal no
 * faturamento mas aparecem aqui sinalizadas (regra de negócio diz que a
 * Planep não deveria ter bonificação).
 */
export function BonificacoesTab() {
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(todayStr())
  const [data, setData] = useState<BonificacoesData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/fase3/bonificacoes?from=${from}&to=${to}`)
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false))
  }, [from, to])

  const diasPeriodo = (new Date(to).getTime() - new Date(from).getTime()) / (1000 * 60 * 60 * 24)
  const mostrarEvolucao = diasPeriodo > 31 && (data?.evolucaoMensal.length ?? 0) > 1

  const colunasDistribuidor: SortableColumn<DistribuidorResumo>[] = [
    { key: 'distribuidor', label: 'Distribuidor', sortValue: (d) => d.distribuidor, render: (d) => (
      <span className="font-medium">
        {d.distribuidor}
        {d.regraViolada && (
          <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
            regra: não deveria ter bonificação
          </span>
        )}
      </span>
    ) },
    { key: 'n', label: 'Transações', align: 'right', sortValue: (d) => d.n, render: (d) => fmt(d.n) },
    { key: 'valorNominal', label: 'Valor nominal', align: 'right', sortValue: (d) => d.valorNominal, render: (d) => fmtMoeda(d.valorNominal) },
  ]

  const colunasCliente: SortableColumn<DistribuidorClienteResumo>[] = [
    { key: 'distribuidor', label: 'Distribuidor', sortValue: (d) => d.distribuidor, render: (d) => d.distribuidor },
    { key: 'cliente', label: 'Cliente', sortValue: (d) => d.cliente, render: (d) => <span className="font-medium">{d.cliente}</span> },
    { key: 'n', label: 'Transações', align: 'right', sortValue: (d) => d.n, render: (d) => fmt(d.n) },
    { key: 'quantidade', label: 'Quantidade', align: 'right', sortValue: (d) => d.quantidade, render: (d) => fmt(d.quantidade, 2) },
    { key: 'valorNominal', label: 'Valor nominal', align: 'right', sortValue: (d) => d.valorNominal, render: (d) => fmtMoeda(d.valorNominal) },
    {
      key: 'diferencaTabela4',
      label: 'Diferença vs tabela preço base',
      align: 'right',
      sortValue: (d) => d.diferencaTabela4,
      render: (d) => <span className="text-slate-500">{fmtMoeda(d.diferencaTabela4)}</span>,
    },
  ]

  const colunasDetalhe: SortableColumn<LinhaDetalhe>[] = [
    { key: 'data', label: 'Data', sortValue: (l) => l.data, render: (l) => fmtDateBR(l.data) },
    { key: 'distribuidor', label: 'Distribuidor', sortValue: (l) => l.distribuidor, render: (l) => l.distribuidor },
    { key: 'cliente', label: 'Cliente', sortValue: (l) => l.cliente, render: (l) => l.cliente },
    { key: 'produto', label: 'Produto', sortValue: (l) => l.produto, render: (l) => <span className="text-xs">{l.produto}</span> },
    { key: 'quantidade', label: 'Qtd', align: 'right', sortValue: (l) => l.quantidade, render: (l) => fmt(l.quantidade, 2) },
    { key: 'precoVendido', label: 'Preço vendido', align: 'right', sortValue: (l) => l.precoVendido, render: (l) => fmtMoeda(l.precoVendido) },
    { key: 'valorNominal', label: 'Valor nominal', align: 'right', sortValue: (l) => l.valorNominal, render: (l) => fmtMoeda(l.valorNominal) },
    { key: 'precoMedioTabela4', label: 'Tabela preço base', align: 'right', sortValue: (l) => l.precoMedioTabela4, render: (l) => fmtMoeda(l.precoMedioTabela4) },
  ]

  const colunasSemTabela4: SortableColumn<BonificacaoSemTabela4>[] = [
    { key: 'data', label: 'Data', sortValue: (l) => l.data, render: (l) => fmtDateBR(l.data) },
    { key: 'distribuidor', label: 'Distribuidor', sortValue: (l) => l.distribuidor, render: (l) => l.distribuidor },
    { key: 'cliente', label: 'Cliente', sortValue: (l) => l.cliente, render: (l) => <span className="font-medium">{l.cliente}</span> },
    { key: 'produto', label: 'Produto', sortValue: (l) => l.produto, render: (l) => <span className="text-xs">{l.produto}</span> },
    { key: 'quantidade', label: 'Qtd', align: 'right', sortValue: (l) => l.quantidade, render: (l) => fmt(l.quantidade, 2) },
    { key: 'precoVendido', label: 'Preço vendido', align: 'right', sortValue: (l) => l.precoVendido, render: (l) => fmtMoeda(l.precoVendido) },
    { key: 'valorBonificacao', label: 'Valor bonificado', align: 'right', sortValue: (l) => l.valorBonificacao, render: (l) => fmtMoeda(l.valorBonificacao) },
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
          <p className="text-xs text-slate-500">O que gerou a bonificação (tabela preço base)</p>
          <p className="text-lg font-semibold" style={{ color: COR_TABELA4 }}>{fmtMoeda(data?.totalTabela4 ?? 0)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">O que foi faturado em bonificação (nominal)</p>
          <p className="text-lg font-semibold" style={{ color: COR_NOMINAL }}>{fmtMoeda(data?.totalNominal ?? 0)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">Transações de bonificação</p>
          <p className="text-lg font-semibold">{fmt(data?.totalTransacoes ?? 0)}</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-xs text-amber-800">Distribuidores com bonificação "indevida"</p>
          <p className="text-lg font-semibold text-amber-900">
            {(data?.porDistribuidor ?? []).filter((d) => d.regraViolada).map((d) => d.distribuidor).join(', ') || '—'}
          </p>
        </div>
      </div>

      {mostrarEvolucao && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 font-medium">Evolução mensal — gerado (tabela preço base) x faturado (nominal)</div>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={data?.evolucaoMensal ?? []}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="mes" tickFormatter={fmtMes} tick={{ fontSize: 12 }} />
              <YAxis tickFormatter={(v) => fmt(Number(v))} tick={{ fontSize: 12 }} />
              <Tooltip
                labelFormatter={(mes) => fmtMes(String(mes))}
                formatter={(v, name) => [fmtMoeda(Number(v)), String(name)]}
              />
              <Legend />
              <Bar dataKey="tabela4" name="Gerado (tabela preço base)" fill={COR_TABELA4} radius={[4, 4, 0, 0]} />
              <Bar dataKey="nominal" name="Faturado (nominal)" fill={COR_NOMINAL} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3 font-medium">Bonificações por distribuidor</div>
        <SortableTable
          columns={colunasDistribuidor}
          rows={data?.porDistribuidor ?? []}
          rowKey={(d) => d.distribuidor}
          defaultSortKey="valorNominal"
        />
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3 font-medium">
          Destino das bonificações — por distribuidor × cliente
        </div>
        <SortableTable
          columns={colunasCliente}
          rows={data?.porDistribuidorCliente ?? []}
          rowKey={(d) => `${d.distribuidor}|${d.cliente}`}
          defaultSortKey="valorNominal"
        />
      </div>

      <div className="overflow-x-auto rounded-xl border border-amber-300 bg-white">
        <div className="border-b border-amber-100 bg-amber-50 px-4 py-3 font-medium text-amber-900">
          Bonificações sem tabela preço base de distribuidor ({data?.totalSemTabela4 ?? 0}) — não dá para calcular o
          valor real bonificado (diferença entre a tabela preço base e o preço vendido, comparada ao preço mínimo)
        </div>
        <SortableTable
          columns={colunasSemTabela4}
          rows={data?.semTabela4 ?? []}
          rowKey={(l, i) => `${l.data}-${l.distribuidor}-${l.cliente}-${l.produto}-${i}`}
          defaultSortKey="valorBonificacao"
          emptyMessage="Todas as bonificações do período têm tabela preço base vigente."
        />
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3 font-medium">
          Transações de bonificação — detalhe ({data?.linhasDetalhe.length ?? 0})
        </div>
        <SortableTable
          columns={colunasDetalhe}
          rows={data?.linhasDetalhe ?? []}
          rowKey={(l, i) => `${l.data}-${l.distribuidor}-${l.cliente}-${l.produto}-${i}`}
          defaultSortKey="data"
        />
      </div>
    </div>
  )
}
