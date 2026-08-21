'use client'

import { useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CategoriaFiltro, CATEGORIA_PADRAO } from './CategoriaFiltro'
import { ComparativoCotas, type ComparativoCotasData } from './ComparativoCotas'
import { ClienteFiltro } from './ClienteFiltro'
import { TabelaDistribuidores } from './TabelaDistribuidores'
import { SortableTable, type SortableColumn } from '@/components/shared/SortableTable'

// Cores fixas por identidade (Mourão/Peças), nunca cicladas — mesma paleta
// categórica já usada em src/components/fase1/Charts.tsx.
const COR_MOURAO = '#047857'
const COR_PECAS = '#0e7490'

interface VendaAgregada {
  chave: string
  faturamentoBruto: number
  descontos: number
  devolucoes: number
  bonificacoes: number
  faturamentoLiquido: number
  vendasUN: number
  m3Total: number
  valorM3Vendido: number | null
  precoPonderado: number | null
  abaixoDoMinimo: boolean
  perdaEstimada: number
  margem: number | null
}

interface DistribuidorCliente extends VendaAgregada {
  distribuidor: string
  cliente: string
}

interface VendaPorProdutoEspecifico extends VendaAgregada {
  distribuidor: string
  produto: string
  tabelaPreco: string
}

interface VendaPorProdutoMes extends VendaAgregada {
  distribuidor: string
  produto: string
  tabelaPreco: string
  mes: string
}

interface VendaPorProdutoCliente extends VendaAgregada {
  distribuidor: string
  produto: string
  tabelaPreco: string
  cliente: string
}

interface MesDetalhe {
  mes: string
  totalGeral: VendaAgregada | null
  porTabela: VendaAgregada[]
  porDistribuidor: VendaAgregada[]
  porProdutoEspecifico: VendaPorProdutoEspecifico[]
}

interface InsightMouraoPecas {
  m3Mourao: number
  m3Pecas: number
  pctMourao: number
  pctPecas: number
  precoMouraoAtual: number
  precoPecasAtual: number
  metaBlend: number
  precoPecasMinimoNecessario: number
  precoMouraoMinimoNecessario: number
}

interface InsightDiametroMourao {
  classe1: string
  classe2: string
  unidadesClasse1: number
  unidadesClasse2: number
  m3Classe1: number
  m3Classe2: number
  /** por unidade vendida — não por m³ */
  pctClasse1: number
  pctClasse2: number
  metaUnidadesClasse1: number | null
  metaUnidadesClasse2: number | null
  metaM3Classe1: number | null
  metaM3Classe2: number | null
  metaPctClasse1: number | null
  metaPctClasse2: number | null
  dentroDaMeta: boolean | null
}

interface EstrategicoData {
  ano: string
  anosDisponiveis: string[]
  categoriasDisponiveis: string[]
  porCategoria: VendaAgregada[]
  clientesDisponiveis: string[]
  totalGeral: VendaAgregada | null
  porTabelaAno: VendaAgregada[]
  porSubTipoProdutoAno: VendaAgregada[]
  insightMouraoPecas: InsightMouraoPecas | null
  marcasDisponiveis: string[]
  porMarca: VendaAgregada[]
  insightDiametroMourao: InsightDiametroMourao | null
  evolucaoMouraoPecas: {
    mes: string
    pctMourao: number | null
    pctPecas: number | null
    precoMourao: number | null
    precoPecas: number | null
  }[]
  perdaEstimadaTotal: number
  mesesComVenda: number
  mesesComPerda: number
  mesesOk: number
  porMes: VendaAgregada[]
  porDistribuidor: VendaAgregada[]
  porDistribuidorCliente: DistribuidorCliente[]
  porDistribuidorClienteProduto: (DistribuidorCliente & { produto: string })[]
  distribuidoresSemVenda: string[]
  porProdutoEspecifico: VendaPorProdutoEspecifico[]
  porProdutoMes: VendaPorProdutoMes[]
  porProdutoCliente: VendaPorProdutoCliente[]
  melhoresGanhosDistribuidor: VendaAgregada[]
  melhoresGanhosProduto: VendaPorProdutoEspecifico[]
  mesDetalhe: MesDetalhe | null
  comparativoCotas: ComparativoCotasData | null
  linhasSemDados: boolean
}

function fmt(n: number | null, digits = 0): string {
  if (n == null) return '—'
  return n.toLocaleString('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: digits })
}
function fmtMoeda(n: number | null): string {
  if (n == null) return '—'
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 })
}
/** 'YYYY-MM' -> 'MM/AAAA' */
function fmtMes(iso: string): string {
  const [ano, mes] = iso.split('-')
  if (!ano || !mes) return iso
  return `${mes}/${ano}`
}
/** % abaixo do mínimo ponderado — pedido do usuário 2026-08-04: "no painel mensal, clientes abaixo do mínimo, colocar o % abaixo". */
function percAbaixo(v: { valorM3Vendido: number | null; precoPonderado: number | null }): number | null {
  if (v.valorM3Vendido == null || v.precoPonderado == null || v.precoPonderado === 0) return null
  return ((v.precoPonderado - v.valorM3Vendido) / v.precoPonderado) * 100
}
function fmtPerc(n: number | null): string {
  if (n == null) return ''
  return ` (${n.toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%)`
}

function TabelaGanhoPerda({
  titulo,
  linhas,
  labelChave,
}: {
  titulo: string
  linhas: (VendaAgregada & { distribuidor?: string; produto?: string; tabelaPreco?: string })[]
  labelChave: string
}) {
  const colunas: SortableColumn<VendaAgregada & { distribuidor?: string; produto?: string; tabelaPreco?: string }>[] = [
    {
      key: 'chave',
      label: labelChave,
      sortValue: (d) => d.produto ?? d.chave,
      render: (d) => (
        <div>
          {d.distribuidor && <span className="mr-1 text-xs text-slate-500">[{d.distribuidor}]</span>}
          <span className="font-medium">{d.produto ?? d.chave}</span>
          {d.tabelaPreco && <span className="ml-1 text-xs text-slate-500">({d.tabelaPreco})</span>}
        </div>
      ),
    },
    { key: 'faturamentoLiquido', label: 'Faturamento líquido', align: 'right', sortValue: (d) => d.faturamentoLiquido, render: (d) => fmtMoeda(d.faturamentoLiquido) },
    { key: 'valorM3Vendido', label: 'R$/m³ vendido', align: 'right', sortValue: (d) => d.valorM3Vendido ?? 0, render: (d) => fmtMoeda(d.valorM3Vendido) },
    { key: 'precoPonderado', label: 'Mínimo ponderado', align: 'right', sortValue: (d) => d.precoPonderado ?? 0, render: (d) => fmtMoeda(d.precoPonderado) },
    {
      key: 'margem',
      label: 'Margem',
      align: 'right',
      sortValue: (d) => d.margem ?? 0,
      render: (d) => <span className="font-medium text-emerald-700">{fmtMoeda(d.margem)}</span>,
    },
  ]
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-4 py-3 font-medium">{titulo}</div>
      <SortableTable columns={colunas} rows={linhas} rowKey={(d, i) => `${d.chave}-${i}`} defaultSortKey="margem" emptyMessage="Nenhum ganho no recorte." />
    </div>
  )
}

/**
 * Fase 3 — Painel estratégico anual: pedido do usuário 2026-08-04 ("montar
 * um painel estratégico pegando os números do ano para ver onde estão as
 * perdas, visto que nos meses anteriores conseguimos bater as metas de
 * preço médio"). Mostra o ano inteiro mês a mês (quais bateram a meta de
 * preço médio e quais não bateram), onde a perda de preço se concentrou e
 * onde estão os melhores ganhos (distribuidor/produto).
 */
export function PainelEstrategico() {
  const [ano, setAno] = useState(String(new Date().getFullYear()))
  const [categorias, setCategorias] = useState<string[]>([CATEGORIA_PADRAO])
  const [marcas, setMarcas] = useState<string[]>([])
  const [clienteFiltro, setClienteFiltro] = useState<string | null>(null)
  const [mesSelecionado, setMesSelecionado] = useState<string | null>(null)
  const [data, setData] = useState<EstrategicoData | null>(null)
  const [loading, setLoading] = useState(true)
  // Cards clicáveis (pedido do usuário 2026-08-05: "todos os cards precisam
  // ser clicáveis com o ctrl para selecionar") — clique simples troca a
  // seleção por só aquele card (ou limpa, se já era o único selecionado);
  // Ctrl/Cmd+clique adiciona ou remove da seleção sem mexer nos outros.
  const [tabelasFiltro, setTabelasFiltro] = useState<Set<string>>(new Set())
  const [subTiposFiltro, setSubTiposFiltro] = useState<Set<string>>(new Set())

  function toggleSelecao(set: Set<string>, setSet: (s: Set<string>) => void, valor: string, ctrl: boolean) {
    if (ctrl) {
      const next = new Set(set)
      if (next.has(valor)) next.delete(valor)
      else next.add(valor)
      setSet(next)
    } else {
      setSet(set.size === 1 && set.has(valor) ? new Set() : new Set([valor]))
    }
  }

  useEffect(() => {
    setLoading(true)
    const mesParam = mesSelecionado ? `&mes=${mesSelecionado}` : ''
    const tabelasParam = tabelasFiltro.size ? `&tabelas=${encodeURIComponent([...tabelasFiltro].join(','))}` : ''
    const subTiposParam = subTiposFiltro.size ? `&subtipos=${encodeURIComponent([...subTiposFiltro].join(','))}` : ''
    const clienteParam = clienteFiltro ? `&cliente=${encodeURIComponent(clienteFiltro)}` : ''
    const marcasParam = marcas.length ? `&marcas=${encodeURIComponent(marcas.join(','))}` : ''
    fetch(`/api/fase3/estrategico?ano=${ano}&categorias=${encodeURIComponent(categorias.join(','))}${mesParam}${tabelasParam}${subTiposParam}${clienteParam}${marcasParam}`)
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false))
  }, [ano, categorias, mesSelecionado, tabelasFiltro, subTiposFiltro, clienteFiltro, marcas])

  const anos = data?.anosDisponiveis?.length ? data.anosDisponiveis : [ano]

  const colunasMes: SortableColumn<VendaAgregada>[] = [
    { key: 'chave', label: 'Mês', sortValue: (m) => m.chave, render: (m) => <span className="font-medium">{fmtMes(m.chave)}</span> },
    { key: 'faturamentoLiquido', label: 'Faturamento líquido', align: 'right', sortValue: (m) => m.faturamentoLiquido, render: (m) => fmtMoeda(m.faturamentoLiquido) },
    { key: 'm3Total', label: 'm³ vendido', align: 'right', sortValue: (m) => m.m3Total, render: (m) => fmt(m.m3Total, 1) },
    { key: 'valorM3Vendido', label: 'R$/m³ vendido', align: 'right', sortValue: (m) => m.valorM3Vendido ?? 0, render: (m) => fmtMoeda(m.valorM3Vendido) },
    { key: 'precoPonderado', label: 'Mínimo ponderado', align: 'right', sortValue: (m) => m.precoPonderado ?? 0, render: (m) => fmtMoeda(m.precoPonderado) },
    {
      key: 'perdaEstimada',
      label: 'Perda estimada',
      align: 'right',
      sortValue: (m) => m.perdaEstimada,
      render: (m) => (m.perdaEstimada > 0 ? <span className="font-medium text-red-700">{fmtMoeda(m.perdaEstimada)}</span> : <span className="text-slate-400">—</span>),
    },
    {
      key: 'situacao',
      label: 'Situação',
      sortValue: (m) => (m.abaixoDoMinimo ? 0 : 1),
      render: (m) =>
        m.valorM3Vendido == null ? (
          <span className="text-slate-400">sem m³</span>
        ) : m.abaixoDoMinimo ? (
          <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">abaixo do mínimo{fmtPerc(percAbaixo(m))}</span>
        ) : (
          <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">meta batida</span>
        ),
    },
  ]

  const colunasProduto: SortableColumn<VendaPorProdutoEspecifico>[] = [
    { key: 'distribuidor', label: 'Distribuidor', sortValue: (p) => p.distribuidor, render: (p) => <span className="font-medium">{p.distribuidor}</span> },
    { key: 'produto', label: 'Produto', sortValue: (p) => p.produto, render: (p) => p.produto },
    { key: 'faturamentoLiquido', label: 'Faturamento líquido', align: 'right', sortValue: (p) => p.faturamentoLiquido, render: (p) => fmtMoeda(p.faturamentoLiquido) },
    { key: 'valorM3Vendido', label: 'R$/m³ vendido', align: 'right', sortValue: (p) => p.valorM3Vendido ?? 0, render: (p) => fmtMoeda(p.valorM3Vendido) },
    { key: 'precoPonderado', label: 'Mínimo ponderado', align: 'right', sortValue: (p) => p.precoPonderado ?? 0, render: (p) => fmtMoeda(p.precoPonderado) },
    {
      key: 'perdaEstimada',
      label: 'Perda estimada',
      align: 'right',
      sortValue: (p) => p.perdaEstimada,
      render: (p) => (p.perdaEstimada > 0 ? <span className="font-medium text-red-700">{fmtMoeda(p.perdaEstimada)}</span> : <span className="text-slate-400">—</span>),
    },
  ]

  // Pedido do usuário 2026-08-04: "agrupar por alíquota de ICMS" — cada
  // alíquota tem seu próprio m3_minimo, então misturar todas numa lista só
  // esconde que o "mínimo ponderado" de cada linha já é específico daquela
  // tabela. Cada linha expande e mostra "por mês" (outro pedido do usuário).
  const perdaPorTabela = new Map<string, VendaPorProdutoEspecifico[]>()
  for (const p of (data?.porProdutoEspecifico ?? []).slice(0, 60)) {
    const lista = perdaPorTabela.get(p.tabelaPreco) ?? []
    lista.push(p)
    perdaPorTabela.set(p.tabelaPreco, lista)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div>
          <label className="block text-xs font-medium text-slate-600">Ano</label>
          <select
            value={ano}
            onChange={(e) => {
              setAno(e.target.value)
              setMesSelecionado(null)
            }}
            className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            {anos.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        {loading && <span className="text-xs text-slate-500">carregando…</span>}
      </div>

      <div className="flex flex-wrap items-start gap-3">
        <CategoriaFiltro
          categoriasDisponiveis={data?.categoriasDisponiveis ?? []}
          porCategoria={data?.porCategoria ?? []}
          selecionadas={categorias}
          onChange={setCategorias}
        />
        <CategoriaFiltro
          titulo="Marca"
          categoriasDisponiveis={data?.marcasDisponiveis ?? []}
          porCategoria={data?.porMarca ?? []}
          selecionadas={marcas}
          onChange={setMarcas}
        />
        <ClienteFiltro
          clientesDisponiveis={data?.clientesDisponiveis ?? []}
          selecionado={clienteFiltro}
          onChange={setClienteFiltro}
        />
      </div>

      {data?.linhasSemDados && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Nenhum dado sincronizado ainda para {ano} com essas categorias.
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">Faturamento líquido ({ano})</p>
          <p className="text-lg font-semibold">{fmtMoeda(data?.totalGeral?.faturamentoLiquido ?? null)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">m³ vendido ({ano})</p>
          <p className="text-lg font-semibold">{fmt(data?.totalGeral?.m3Total ?? null, 1)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">Preço médio real ({ano})</p>
          <p className={`text-lg font-semibold ${data?.totalGeral?.abaixoDoMinimo ? 'text-red-700' : ''}`}>
            {fmtMoeda(data?.totalGeral?.valorM3Vendido ?? null)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">Meta de destino — o que deveria ser</p>
          <p className="text-lg font-semibold">{fmtMoeda(data?.totalGeral?.precoPonderado ?? null)}</p>
        </div>
        <div className="rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="text-xs text-red-700">Perda estimada por preço abaixo do mínimo</p>
          <p className="text-lg font-semibold text-red-800">{fmtMoeda(data?.perdaEstimadaTotal ?? null)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">Meses: meta batida x perda</p>
          <p className="text-lg font-semibold">
            <span className="text-emerald-700">{data?.mesesOk ?? 0} ok</span>
            {' / '}
            <span className="text-red-700">{data?.mesesComPerda ?? 0} perda</span>
          </p>
          <p className="mt-0.5 text-xs text-slate-500">de {data?.mesesComVenda ?? 0} meses com venda</p>
        </div>
      </div>

      {/* Pedido do usuário 2026-08-05: "% em volume vendido para cada
          alíquota de ICMS, Faturamento Líquido Total, Preço médio e meta de
          destino" — o segundo trio já existe no grid acima; aqui entra a
          quebra por alíquota que faltava. Clicáveis (pedido do usuário:
          "todos os cards precisam ser clicáveis com o ctrl para
          selecionar") — clique filtra só aquela alíquota, Ctrl+clique
          adiciona/remove da seleção. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {(data?.porTabelaAno ?? []).map((t) => {
          const m3TotalGeral = data?.totalGeral?.m3Total ?? 0
          const pct = m3TotalGeral > 0 ? (t.m3Total / m3TotalGeral) * 100 : null
          const selecionado = tabelasFiltro.has(t.chave)
          return (
            <button
              key={t.chave}
              type="button"
              onClick={(e) => toggleSelecao(tabelasFiltro, setTabelasFiltro, t.chave, e.ctrlKey || e.metaKey)}
              className={`rounded-xl border p-4 text-left transition-shadow ${selecionado ? 'border-emerald-600 ring-2 ring-emerald-600' : 'border-slate-200 bg-white hover:shadow-sm'}`}
            >
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-slate-600">{t.chave}</p>
                <span className="text-xs text-slate-500">{pct != null ? `${fmt(pct, 1)}% do volume` : '—'}</span>
              </div>
              <p className={`mt-1 text-lg font-semibold ${t.abaixoDoMinimo ? 'text-red-700' : ''}`}>{fmtMoeda(t.valorM3Vendido)}</p>
              <p className="text-xs text-slate-500">
                mínimo {fmtMoeda(t.precoPonderado)} · líquido {fmtMoeda(t.faturamentoLiquido)}
              </p>
            </button>
          )
        })}
      </div>
      {tabelasFiltro.size > 0 && (
        <p className="text-xs text-slate-500">
          Filtrando por: {[...tabelasFiltro].join(', ')} —{' '}
          <button type="button" onClick={() => setTabelasFiltro(new Set())} className="underline">
            limpar
          </button>
        </p>
      )}

      {/* Pedido do usuário 2026-08-05: "card com a proporção em volume peças
          e mourão e qual o preço médio do m³ cúbico de peças e mourão" +
          insight de preço mínimo necessário dado o mix real. Clicáveis (ver
          nota do grupo de ICMS acima) — clique filtra só aquele subtipo,
          Ctrl+clique adiciona/remove da seleção. */}
      {(data?.porSubTipoProdutoAno?.length ?? 0) > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="mb-2 text-xs font-medium text-slate-600">Mourão x Peças — proporção e preço médio do m³</p>
            <div className="grid grid-cols-2 gap-3">
              {(data?.porSubTipoProdutoAno ?? []).map((s) => {
                const m3TotalMix = (data?.porSubTipoProdutoAno ?? []).reduce((acc, x) => acc + x.m3Total, 0)
                const pct = m3TotalMix > 0 ? (s.m3Total / m3TotalMix) * 100 : null
                const selecionado = subTiposFiltro.has(s.chave)
                return (
                  <button
                    key={s.chave}
                    type="button"
                    onClick={(e) => toggleSelecao(subTiposFiltro, setSubTiposFiltro, s.chave, e.ctrlKey || e.metaKey)}
                    className={`rounded-lg p-3 text-left ${selecionado ? 'bg-emerald-100 ring-2 ring-emerald-600' : 'bg-slate-50 hover:bg-slate-100'}`}
                  >
                    <p className="text-xs text-slate-500">{s.chave}</p>
                    <p className={`text-lg font-semibold ${s.abaixoDoMinimo ? 'text-red-700' : ''}`}>{fmtMoeda(s.valorM3Vendido)}</p>
                    <p className="text-xs text-slate-500">{pct != null ? `${fmt(pct, 1)}% do volume (${fmt(s.m3Total, 1)} m³)` : '—'}</p>
                  </button>
                )
              })}
            </div>
            {subTiposFiltro.size > 0 && (
              <p className="mt-2 text-xs text-slate-500">
                Filtrando por: {[...subTiposFiltro].join(', ')} —{' '}
                <button type="button" onClick={() => setSubTiposFiltro(new Set())} className="underline">
                  limpar
                </button>
              </p>
            )}
          </div>

          {data?.insightMouraoPecas && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="mb-1 text-xs font-medium text-amber-800">
                Insight — preço mínimo necessário dado o mix atual (
                {fmt(data.insightMouraoPecas.pctMourao * 100, 0)}% Mourão / {fmt(data.insightMouraoPecas.pctPecas * 100, 0)}% Peças)
              </p>
              <p className="text-xs text-amber-900">
                Meta de destino (mínimo ponderado por ICMS, mesmo para os dois): <strong>{fmtMoeda(data.insightMouraoPecas.metaBlend)}</strong>
              </p>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-amber-700">
                    Se Mourão continuar em {fmtMoeda(data.insightMouraoPecas.precoMouraoAtual)}, Peças precisa de no mínimo:
                  </p>
                  <p
                    className={`text-lg font-semibold ${data.insightMouraoPecas.precoPecasMinimoNecessario > data.insightMouraoPecas.precoPecasAtual ? 'text-red-700' : 'text-emerald-700'}`}
                  >
                    {fmtMoeda(data.insightMouraoPecas.precoPecasMinimoNecessario)}
                  </p>
                  <p className="text-xs text-amber-700">real hoje: {fmtMoeda(data.insightMouraoPecas.precoPecasAtual)}</p>
                </div>
                <div>
                  <p className="text-xs text-amber-700">
                    Se Peças continuar em {fmtMoeda(data.insightMouraoPecas.precoPecasAtual)}, Mourão precisa de no mínimo:
                  </p>
                  <p
                    className={`text-lg font-semibold ${data.insightMouraoPecas.precoMouraoMinimoNecessario > data.insightMouraoPecas.precoMouraoAtual ? 'text-red-700' : 'text-emerald-700'}`}
                  >
                    {fmtMoeda(data.insightMouraoPecas.precoMouraoMinimoNecessario)}
                  </p>
                  <p className="text-xs text-amber-700">real hoje: {fmtMoeda(data.insightMouraoPecas.precoMouraoAtual)}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {data?.insightDiametroMourao && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="mb-2 text-xs font-medium text-slate-600">
            Proporção {data.insightDiametroMourao.classe1} x {data.insightDiametroMourao.classe2} — Mourão 2,20m
            <span className="font-normal text-slate-400"> (% por unidade vendida)</span>
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs text-slate-500">Vendido {data.insightDiametroMourao.classe1}</p>
              <p className="text-lg font-semibold">{fmt(data.insightDiametroMourao.pctClasse1 * 100, 0)}%</p>
              <p className="text-xs text-slate-500">
                {fmt(data.insightDiametroMourao.unidadesClasse1, 0)} un · {fmt(data.insightDiametroMourao.m3Classe1, 1)} m³
              </p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs text-slate-500">Vendido {data.insightDiametroMourao.classe2}</p>
              <p className="text-lg font-semibold">{fmt(data.insightDiametroMourao.pctClasse2 * 100, 0)}%</p>
              <p className="text-xs text-slate-500">
                {fmt(data.insightDiametroMourao.unidadesClasse2, 0)} un · {fmt(data.insightDiametroMourao.m3Classe2, 1)} m³
              </p>
            </div>
            {data.insightDiametroMourao.metaPctClasse1 != null && data.insightDiametroMourao.metaPctClasse2 != null ? (
              <>
                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">Meta {data.insightDiametroMourao.classe1}</p>
                  <p className="text-lg font-semibold text-slate-600">{fmt(data.insightDiametroMourao.metaPctClasse1 * 100, 0)}%</p>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">Meta {data.insightDiametroMourao.classe2}</p>
                  <p className="text-lg font-semibold text-slate-600">{fmt(data.insightDiametroMourao.metaPctClasse2 * 100, 0)}%</p>
                </div>
              </>
            ) : (
              <div className="col-span-2 flex items-center rounded-lg bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Sem meta cadastrada para estes dois produtos (Cotas de venda).</p>
              </div>
            )}
          </div>
          {data.insightDiametroMourao.dentroDaMeta != null && (
            <p className="mt-2 text-xs">
              {data.insightDiametroMourao.dentroDaMeta ? (
                <span className="rounded bg-emerald-100 px-2 py-0.5 font-medium text-emerald-800">
                  proporção dentro da meta (±5 p.p.)
                </span>
              ) : (
                <span className="rounded bg-red-100 px-2 py-0.5 font-medium text-red-700">
                  proporção fora da meta — vendendo{' '}
                  {data.insightDiametroMourao.pctClasse1 > (data.insightDiametroMourao.metaPctClasse1 ?? 0)
                    ? `mais ${data.insightDiametroMourao.classe1}`
                    : `mais ${data.insightDiametroMourao.classe2}`}{' '}
                  do que o planejado
                </span>
              )}
            </p>
          )}
        </div>
      )}

      {/* Pedido do usuário 2026-08-05: "vamos montar um gráfico de evolução
          no ano do % peças mourão volume e preços por m3" — dois gráficos
          separados (% e R$/m³ têm escalas muito diferentes; um gráfico com
          dois eixos confundiria mais do que ajudaria), cada um com um único
          eixo. */}
      {(data?.evolucaoMouraoPecas?.length ?? 0) > 1 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="mb-2 text-xs font-medium text-slate-600">Evolução mensal — % do volume (Mourão x Peças)</p>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data?.evolucaoMouraoPecas ?? []} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="mes" tickFormatter={fmtMes} tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} unit="%" domain={[0, 100]} />
                <Tooltip
                  labelFormatter={(v) => fmtMes(String(v))}
                  formatter={(v, name) => [`${fmt(Number(v), 1)}%`, String(name)]}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="pctMourao" name="Mourão" stackId="mix" fill={COR_MOURAO} radius={[0, 0, 0, 0]} />
                <Bar dataKey="pctPecas" name="Peças" stackId="mix" fill={COR_PECAS} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="mb-2 text-xs font-medium text-slate-600">Evolução mensal — R$/m³ vendido (Mourão x Peças)</p>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={data?.evolucaoMouraoPecas ?? []} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="mes" tickFormatter={fmtMes} tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmtMoeda(v)} />
                <Tooltip labelFormatter={(v) => fmtMes(String(v))} formatter={(v, name) => [fmtMoeda(Number(v)), String(name)]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="precoMourao" name="Mourão" stroke={COR_MOURAO} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                <Line type="monotone" dataKey="precoPecas" name="Peças" stroke={COR_PECAS} strokeWidth={2} dot={{ r: 3 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3 font-medium">
          Mês a mês ({ano}) — clique no mês para ver o detalhe
        </div>
        <SortableTable
          columns={colunasMes}
          rows={data?.porMes ?? []}
          rowKey={(m) => m.chave}
          defaultSortKey="chave"
          defaultSortDir="asc"
          emptyMessage="Nenhuma venda no ano."
          renderExpanded={(m) => {
            if (mesSelecionado !== m.chave) {
              return (
                <button
                  type="button"
                  onClick={() => setMesSelecionado(m.chave)}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-100"
                >
                  Carregar detalhe de {fmtMes(m.chave)}
                </button>
              )
            }
            if (!data?.mesDetalhe || data.mesDetalhe.mes !== m.chave) {
              return <span className="text-xs text-slate-400">carregando detalhe…</span>
            }
            const det = data.mesDetalhe
            return (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-lg border border-slate-200 bg-white p-2">
                    <p className="text-xs text-slate-500">Faturamento líquido</p>
                    <p className="font-semibold">{fmtMoeda(det.totalGeral?.faturamentoLiquido ?? null)}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white p-2">
                    <p className="text-xs text-slate-500">m³ vendido</p>
                    <p className="font-semibold">{fmt(det.totalGeral?.m3Total ?? null, 1)}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white p-2">
                    <p className="text-xs text-slate-500">R$/m³ vendido</p>
                    <p className="font-semibold">{fmtMoeda(det.totalGeral?.valorM3Vendido ?? null)}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white p-2">
                    <p className="text-xs text-slate-500">Mínimo ponderado</p>
                    <p className="font-semibold">{fmtMoeda(det.totalGeral?.precoPonderado ?? null)}</p>
                  </div>
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium text-slate-600">
                    Por alíquota de ICMS neste mês — o total acima já pondera as 3 juntas, aqui vai cada uma isolada
                  </p>
                  <table className="w-full text-xs">
                    <thead className="text-left text-slate-500">
                      <tr>
                        <th className="py-1">ICMS</th>
                        <th className="py-1 text-right">R$/m³ vendido</th>
                        <th className="py-1 text-right">Mínimo ponderado</th>
                        <th className="py-1 text-right">Perda estimada</th>
                        <th className="py-1">Situação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {det.porTabela.map((t) => (
                        <tr key={t.chave} className="border-t border-slate-100">
                          <td className="py-1 font-medium">{t.chave}</td>
                          <td className="py-1 text-right">{fmtMoeda(t.valorM3Vendido)}</td>
                          <td className="py-1 text-right">{fmtMoeda(t.precoPonderado)}</td>
                          <td className="py-1 text-right text-red-700">{t.perdaEstimada > 0 ? fmtMoeda(t.perdaEstimada) : '—'}</td>
                          <td className="py-1">
                            {t.valorM3Vendido == null ? (
                              <span className="text-slate-400">sem m³</span>
                            ) : t.abaixoDoMinimo ? (
                              <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700">abaixo{fmtPerc(percAbaixo(t))}</span>
                            ) : (
                              <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800">ok</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium text-slate-600">Por distribuidor neste mês</p>
                  <table className="w-full text-xs">
                    <tbody>
                      {det.porDistribuidor.slice(0, 10).map((d) => (
                        <tr key={d.chave} className="border-t border-slate-100">
                          <td className="py-1">{d.chave}</td>
                          <td className="py-1 text-right">{fmtMoeda(d.faturamentoLiquido)}</td>
                          <td className="py-1 text-right">{fmtMoeda(d.valorM3Vendido)}/m³</td>
                          <td className="py-1 text-right text-red-700">{d.perdaEstimada > 0 ? fmtMoeda(d.perdaEstimada) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium text-slate-600">Top produtos com perda neste mês</p>
                  <table className="w-full text-xs">
                    <tbody>
                      {det.porProdutoEspecifico.slice(0, 10).map((p) => (
                        <tr key={p.chave} className="border-t border-slate-100">
                          <td className="py-1">
                            {p.produto} <span className="text-slate-400">({p.distribuidor}, {p.tabelaPreco})</span>
                          </td>
                          <td className="py-1 text-right">{fmtMoeda(p.valorM3Vendido)}/m³</td>
                          <td className="py-1 text-right text-red-700">{p.perdaEstimada > 0 ? fmtMoeda(p.perdaEstimada) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          }}
        />
      </div>

      <ComparativoCotas data={data?.comparativoCotas} periodoLabel={`o ano de ${ano}`} />

      <TabelaDistribuidores
        titulo={`Onde estão as perdas — por distribuidor (${ano})`}
        porDistribuidor={data?.porDistribuidor ?? []}
        porDistribuidorCliente={data?.porDistribuidorCliente ?? []}
        porDistribuidorClienteProduto={data?.porDistribuidorClienteProduto ?? []}
        distribuidoresSemVenda={data?.distribuidoresSemVenda ?? []}
      />

      {[...perdaPorTabela.entries()].map(([tabelaPreco, linhas]) => (
        <div key={tabelaPreco} className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-3 font-medium">
            Onde estão as perdas — por produto — {tabelaPreco} ({ano}) — clique na linha para ver por mês
          </div>
          <SortableTable
            columns={colunasProduto}
            rows={linhas}
            rowKey={(p) => p.chave}
            defaultSortKey="perdaEstimada"
            emptyMessage="Nenhuma venda no ano nessa alíquota."
            renderExpanded={(p) => {
              const meses = (data?.porProdutoMes ?? [])
                .filter((m) => m.distribuidor === p.distribuidor && m.produto === p.produto && m.tabelaPreco === p.tabelaPreco)
                .sort((a, b) => a.mes.localeCompare(b.mes))
              const clientes = (data?.porProdutoCliente ?? [])
                .filter((c) => c.distribuidor === p.distribuidor && c.produto === p.produto && c.tabelaPreco === p.tabelaPreco)
                .sort((a, b) => b.perdaEstimada - a.perdaEstimada)
              return (
                <div className="space-y-3">
                  <div>
                    <p className="mb-1 pl-2 text-xs font-medium text-slate-600">Por mês</p>
                    {meses.length === 0 ? (
                      <p className="pl-2 text-xs text-slate-400">Sem detalhe mensal.</p>
                    ) : (
                      <table className="w-full text-xs">
                        <thead className="text-left text-slate-500">
                          <tr>
                            <th className="py-1 pl-2">Mês</th>
                            <th className="py-1 text-right">R$/m³ vendido</th>
                            <th className="py-1 text-right">Mínimo ponderado</th>
                            <th className="py-1 text-right">Perda estimada</th>
                            <th className="py-1">Situação</th>
                          </tr>
                        </thead>
                        <tbody>
                          {meses.map((m) => (
                            <tr key={m.mes} className="border-t border-slate-100">
                              <td className="py-1 pl-2">{fmtMes(m.mes)}</td>
                              <td className="py-1 text-right">{fmtMoeda(m.valorM3Vendido)}</td>
                              <td className="py-1 text-right">{fmtMoeda(m.precoPonderado)}</td>
                              <td className="py-1 text-right text-red-700">{m.perdaEstimada > 0 ? fmtMoeda(m.perdaEstimada) : '—'}</td>
                              <td className="py-1">
                                {m.valorM3Vendido == null ? (
                                  <span className="text-slate-400">sem m³</span>
                                ) : m.abaixoDoMinimo ? (
                                  <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700">abaixo{fmtPerc(percAbaixo(m))}</span>
                                ) : (
                                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800">ok</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                  <div>
                    <p className="mb-1 pl-2 text-xs font-medium text-slate-600">
                      Por cliente — pedido do usuário 2026-08-04: "quem está pior"
                    </p>
                    {clientes.length === 0 ? (
                      <p className="pl-2 text-xs text-slate-400">Sem detalhe por cliente.</p>
                    ) : (
                      <table className="w-full text-xs">
                        <thead className="text-left text-slate-500">
                          <tr>
                            <th className="py-1 pl-2">Cliente</th>
                            <th className="py-1 text-right">R$/m³ vendido</th>
                            <th className="py-1 text-right">Mínimo ponderado</th>
                            <th className="py-1 text-right">Perda estimada</th>
                            <th className="py-1">Situação</th>
                          </tr>
                        </thead>
                        <tbody>
                          {clientes.map((c) => (
                            <tr key={c.cliente} className="border-t border-slate-100">
                              <td className="py-1 pl-2">{c.cliente}</td>
                              <td className="py-1 text-right">{fmtMoeda(c.valorM3Vendido)}</td>
                              <td className="py-1 text-right">{fmtMoeda(c.precoPonderado)}</td>
                              <td className="py-1 text-right text-red-700">{c.perdaEstimada > 0 ? fmtMoeda(c.perdaEstimada) : '—'}</td>
                              <td className="py-1">
                                {c.valorM3Vendido == null ? (
                                  <span className="text-slate-400">sem m³</span>
                                ) : c.abaixoDoMinimo ? (
                                  <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700">abaixo{fmtPerc(percAbaixo(c))}</span>
                                ) : (
                                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800">ok</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              )
            }}
          />
        </div>
      ))}

      <TabelaGanhoPerda titulo={`Onde estão meus melhores ganhos — por distribuidor (${ano})`} linhas={data?.melhoresGanhosDistribuidor ?? []} labelChave="Distribuidor" />
      <TabelaGanhoPerda titulo={`Onde estão meus melhores ganhos — por produto (${ano}, top 20)`} linhas={(data?.melhoresGanhosProduto ?? []).slice(0, 20)} labelChave="Produto" />
    </div>
  )
}
