'use client'

import { useEffect, useState } from 'react'
import { SortableTable, type SortableColumn } from '@/components/shared/SortableTable'
import { fmtDateBR, SingleDateInput } from '@/components/shared/DateRangeInputs'
import { hojeBrasil, diaAnteriorStr } from '@/lib/horario-brasil'
import { CategoriaFiltro } from './CategoriaFiltro'

interface VendaAgregada {
  chave: string
  faturamentoBruto: number
  descontos: number
  devolucoes: number
  bonificacaoUnidades: number
  bonificacaoM3: number
  faturamentoLiquido: number
  vendasUN: number
  m3Total: number
  valorM3Vendido: number | null
  precoPonderado: number | null
  abaixoDoMinimo: boolean
  perdaEstimada: number
  faturamentoPrecoBase: number
  faturamentoLiquidoPrecoBase: number
  volumeExpedidoM3: number
}

interface ProdutoEspecifico extends VendaAgregada {
  produto: string
  tabelaPreco: string
}

interface NotaFiscalResumo extends VendaAgregada {
  numeroMov: string
  tipoMovimento: string
}

interface RelatorioDiaData {
  period: { from: string; to: string; toSolicitado: string }
  totalGeral: (VendaAgregada & { bonificacaoDoMes: number }) | null
  categoriasDisponiveis: string[]
  porCategoria: VendaAgregada[]
  porDistribuidor: VendaAgregada[]
  porCliente: VendaAgregada[]
  porProdutoEspecifico: ProdutoEspecifico[]
  porNota: NotaFiscalResumo[]
  linhasSemDados: boolean
}

function fmt(n: number, digits = 0): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: digits })
}
function fmtMoeda(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 })
}

/**
 * % que o R$/m³ realmente vendido representa da Meta de destino — pedido do
 * usuário 2026-08-24: "colocar o % que preço médio [é] para meta de
 * destino". 100% = bateu a meta exatamente; abaixo de 100% = vendeu abaixo
 * do mínimo esperado.
 */
function pctMeta(v: { valorM3Vendido: number | null; precoPonderado: number | null }): number | null {
  if (v.valorM3Vendido == null || v.precoPonderado == null || v.precoPonderado === 0) return null
  return (v.valorM3Vendido / v.precoPonderado) * 100
}
function fmtPct(n: number | null): string {
  return n == null ? '' : ` (${n.toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%)`
}

function totalFooter(rows: VendaAgregada[]) {
  const faturamentoLiquido = rows.reduce((s, r) => s + r.faturamentoLiquido, 0)
  const vendasUN = rows.reduce((s, r) => s + r.vendasUN, 0)
  const m3Total = rows.reduce((s, r) => s + r.m3Total, 0)
  const faturamentoLiquidoPrecoBase = rows.reduce((s, r) => s + r.faturamentoLiquidoPrecoBase, 0)
  const valorM3Total = m3Total > 0 ? faturamentoLiquidoPrecoBase / m3Total : null
  return (
    <>
      <td className="px-3 py-2 text-xs text-slate-500">Total</td>
      <td className="px-3 py-2 text-right">{fmtMoeda(faturamentoLiquido)}</td>
      <td className="px-3 py-2 text-right">{fmt(vendasUN)}</td>
      <td className="px-3 py-2 text-right">{fmt(m3Total, 1)}</td>
      <td className="px-3 py-2 text-right">{fmtMoeda(valorM3Total)}</td>
      <td className="px-3 py-2 text-right">—</td>
      <td className="px-3 py-2" />
    </>
  )
}

function colunasResumo(rotuloChave: string): SortableColumn<VendaAgregada>[] {
  return [
    { key: 'chave', label: rotuloChave, sortValue: (r) => r.chave, render: (r) => <span className="font-medium">{r.chave}</span> },
    { key: 'faturamentoLiquido', label: 'Faturamento líquido', align: 'right', sortValue: (r) => r.faturamentoLiquido, render: (r) => fmtMoeda(r.faturamentoLiquido) },
    { key: 'vendasUN', label: 'Quantidade (un)', align: 'right', sortValue: (r) => r.vendasUN, render: (r) => fmt(r.vendasUN) },
    { key: 'm3Total', label: 'm³ vendido', align: 'right', sortValue: (r) => r.m3Total, render: (r) => fmt(r.m3Total, 1) },
    { key: 'valorM3Vendido', label: 'R$/m³ vendido', align: 'right', sortValue: (r) => r.valorM3Vendido ?? 0, render: (r) => fmtMoeda(r.valorM3Vendido) },
    { key: 'precoPonderado', label: 'Meta de destino', align: 'right', sortValue: (r) => r.precoPonderado ?? 0, render: (r) => fmtMoeda(r.precoPonderado) },
    {
      key: 'situacao',
      label: 'Situação',
      sortValue: (r) => (r.abaixoDoMinimo ? 0 : 1),
      render: (r) =>
        r.valorM3Vendido == null ? (
          <span className="text-slate-400">sem m³</span>
        ) : r.abaixoDoMinimo ? (
          <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">abaixo do mínimo{fmtPct(pctMeta(r))}</span>
        ) : (
          <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">dentro do mínimo{fmtPct(pctMeta(r))}</span>
        ),
    },
  ]
}

function TabelaResumo({ titulo, rows, rotuloChave }: { titulo: string; rows: VendaAgregada[]; rotuloChave: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white print:break-inside-avoid">
      <div className="border-b border-slate-100 px-4 py-2 text-sm font-medium">
        {titulo} ({rows.length})
      </div>
      <SortableTable
        columns={colunasResumo(rotuloChave)}
        rows={rows}
        rowKey={(r) => r.chave}
        defaultSortKey="faturamentoLiquido"
        emptyMessage="Nenhuma venda neste recorte."
        renderFooter={rows.length > 0 ? totalFooter : undefined}
      />
    </div>
  )
}

/**
 * Relatório de um dia só (D-1 por padrão) — pedido do usuário, feito bem no
 * início da sessão ("relatório de one page report de D-1, podendo filtrar
 * uma data específica... no detalhe as vendas do dia anterior") e retomado
 * no fim ("indicadores de venda por dia com análise de distribuidor, cliente
 * e produto"). Reaproveita a MESMA `/api/fase3/data` do resto do painel
 * (from=to=data), sem filtro de categoria/marca — igual ao "Hoje" do
 * resumo financeiro, a ideia aqui é "tudo que vendemos naquele dia", não um
 * recorte já filtrado que o usuário deixou selecionado em outra aba.
 */
export function RelatorioDiaTab() {
  const [data, setData] = useState(() => diaAnteriorStr(hojeBrasil()))
  const [categorias, setCategorias] = useState<string[]>([])
  const [info, setInfo] = useState<RelatorioDiaData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const categoriasParam = categorias.length ? `&categorias=${encodeURIComponent(categorias.join(','))}` : ''
    fetch(`/api/fase3/data?from=${data}&to=${data}${categoriasParam}`)
      .then((r) => r.json())
      .then(setInfo)
      .finally(() => setLoading(false))
  }, [data, categorias])

  const numeroNotas = info?.porNota.filter((n) => n.tipoMovimento === 'Vendas').length ?? 0
  const total = info?.totalGeral ?? null

  return (
    <div id="relatorio-d1-print-area" className="space-y-4 print:space-y-2">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 print:hidden">
        <SingleDateInput label="Data" valueIso={data} onChange={setData} />
        <button
          type="button"
          onClick={() => setData(diaAnteriorStr(hojeBrasil()))}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-50"
        >
          D-1 (ontem)
        </button>
        <button type="button" onClick={() => window.print()} className="ml-auto rounded-md border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-50">
          Imprimir
        </button>
      </div>

      <div className="print:hidden">
        <CategoriaFiltro
          categoriasDisponiveis={info?.categoriasDisponiveis ?? []}
          porCategoria={info?.porCategoria ?? []}
          selecionadas={categorias}
          onChange={setCategorias}
        />
      </div>

      <div>
        <h2 className="text-lg font-semibold">Vendas de {fmtDateBR(data)}</h2>
        <p className="text-xs text-slate-500">
          {categorias.length > 0 ? `Categorias: ${categorias.join(', ')}` : 'Todas as categorias'} — todos os movimentos do dia, one page report.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">carregando…</p>
      ) : info?.linhasSemDados ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Nenhuma venda sincronizada para esta data.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 print:grid-cols-4 print:gap-1.5">
            <div className="rounded-lg border border-slate-200 bg-white p-3 print:p-1.5">
              <p className="text-xs text-slate-500">Faturamento líquido</p>
              <p className="text-lg font-semibold">{fmtMoeda(total?.faturamentoLiquido ?? null)}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-3 print:p-1.5">
              <p className="text-xs text-slate-500">m³ vendido</p>
              <p className="text-lg font-semibold">{fmt(total?.m3Total ?? 0, 1)}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-3 print:p-1.5">
              <p className="text-xs text-slate-500">Notas fiscais (vendas)</p>
              <p className="text-lg font-semibold">{fmt(numeroNotas)}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-3 print:p-1.5">
              <p className="text-xs text-slate-500">R$/m³ vendido</p>
              <p className="text-lg font-semibold">{fmtMoeda(total?.valorM3Vendido ?? null)}</p>
              {total && pctMeta(total) != null && (
                <p className={`text-xs font-medium ${total.abaixoDoMinimo ? 'text-red-700' : 'text-emerald-700'}`}>
                  {pctMeta(total)!.toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 })}% da meta
                </p>
              )}
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-3 print:p-1.5">
              <p className="text-xs text-slate-500">Meta de destino</p>
              <p className="text-lg font-semibold">{fmtMoeda(total?.precoPonderado ?? null)}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-3 print:p-1.5">
              <p className="text-xs text-slate-500">Perda estimada</p>
              <p className={`text-lg font-semibold ${total && total.perdaEstimada > 0 ? 'text-red-700' : ''}`}>
                {total && total.perdaEstimada > 0 ? fmtMoeda(total.perdaEstimada) : '—'}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-3 print:p-1.5">
              <p className="text-xs text-slate-500">Bonificação</p>
              <p className="text-lg font-semibold">{fmt(total?.bonificacaoUnidades ?? 0)} un</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-3 print:p-1.5">
              <p className="text-xs text-slate-500">Devolução</p>
              <p className="text-lg font-semibold">{fmtMoeda(total?.devolucoes ?? null)}</p>
            </div>
          </div>

          <TabelaResumo titulo="Por categoria" rows={info?.porCategoria ?? []} rotuloChave="Categoria" />
          <TabelaResumo titulo="Por distribuidor" rows={info?.porDistribuidor ?? []} rotuloChave="Distribuidor" />
          <TabelaResumo titulo="Por cliente" rows={info?.porCliente ?? []} rotuloChave="Cliente" />

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white print:break-inside-avoid">
            <div className="border-b border-slate-100 px-4 py-2 text-sm font-medium">
              Por produto ({info?.porProdutoEspecifico.length ?? 0})
            </div>
            <SortableTable
              columns={[
                { key: 'produto', label: 'Produto', sortValue: (p: ProdutoEspecifico) => p.produto, render: (p) => <span className="font-medium">{p.produto}</span> },
                { key: 'tabelaPreco', label: 'Tabela', sortValue: (p: ProdutoEspecifico) => p.tabelaPreco, render: (p) => <span className="text-xs text-slate-600">{p.tabelaPreco}</span> },
                { key: 'faturamentoLiquido', label: 'Faturamento líquido', align: 'right', sortValue: (p: ProdutoEspecifico) => p.faturamentoLiquido, render: (p) => fmtMoeda(p.faturamentoLiquido) },
                { key: 'vendasUN', label: 'Quantidade (un)', align: 'right', sortValue: (p: ProdutoEspecifico) => p.vendasUN, render: (p) => fmt(p.vendasUN) },
                { key: 'm3Total', label: 'm³ vendido', align: 'right', sortValue: (p: ProdutoEspecifico) => p.m3Total, render: (p) => fmt(p.m3Total, 1) },
                { key: 'valorM3Vendido', label: 'R$/m³ vendido', align: 'right', sortValue: (p: ProdutoEspecifico) => p.valorM3Vendido ?? 0, render: (p) => fmtMoeda(p.valorM3Vendido) },
                { key: 'precoPonderado', label: 'Meta de destino', align: 'right', sortValue: (p: ProdutoEspecifico) => p.precoPonderado ?? 0, render: (p) => fmtMoeda(p.precoPonderado) },
              ]}
              rows={info?.porProdutoEspecifico ?? []}
              rowKey={(p, i) => `${p.produto}-${p.tabelaPreco}-${i}`}
              defaultSortKey="faturamentoLiquido"
              emptyMessage="Nenhuma venda neste recorte."
            />
          </div>
        </>
      )}
    </div>
  )
}
