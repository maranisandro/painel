'use client'

import { Fragment, useEffect, useState } from 'react'
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { DateRangeInputs, fmtDateBR } from '@/components/shared/DateRangeInputs'
import { SortableTable } from '@/components/shared/SortableTable'
import { CategoriaFiltro, CATEGORIA_PADRAO } from './CategoriaFiltro'
import { ComparativoCotas, type ComparativoCotasData } from './ComparativoCotas'
import { ClienteFiltro } from './ClienteFiltro'
import { PainelEstrategico } from './PainelEstrategico'
import { TabelaDistribuidores } from './TabelaDistribuidores'
import { BonificacoesTab } from './BonificacoesTab'
import { CriticaModeloTab } from './CriticaModeloTab'
import { MelhorCargaTab } from './MelhorCargaTab'
import { ClientesTab } from './ClientesTab'
import { ClientesPotenciaisTab } from './ClientesPotenciaisTab'
import { RelatorioDiaTab } from './RelatorioDiaTab'

// Cores fixas por identidade — mesmo padrão de cores já usado em
// BonificacoesTab: âmbar = "o que foi realizado", cinza = "referência/meta".
const COR_REALIZADO = '#b45309'
const COR_META = '#475569'

// Cor fixa por TipoProduto (nunca ciclada — regra da skill dataviz), para o
// gráfico de volume empilhado por dia. Cobre todas as categorias conhecidas
// da cascata de classificação (ver nota Fase 3 no Obsidian); qualquer tipo
// novo/desconhecido cai no cinza de fallback.
const CORES_TIPO_PRODUTO: Record<string, string> = {
  'Agronegócio': '#0f766e',
  'Perfil': '#7c3aed',
  'Perfil In-Natura': '#a78bfa',
  'Perfil - Linha 2': '#c4b5fd',
  'Maravalha': '#ca8a04',
  'Lenha': '#92400e',
  'Lenha UTM': '#d97706',
  'Resíduo Tratado': '#be123c',
  'Resíduo Colheita': '#fb7185',
  'Serragem': '#0369a1',
  'Construção Civil': '#4338ca',
  'CEMIG': '#0891b2',
}
const COR_TIPO_FALLBACK = '#94a3b8'
function corTipoProduto(tipo: string): string {
  return CORES_TIPO_PRODUTO[tipo] ?? COR_TIPO_FALLBACK
}

type TipoMovimento = 'Vendas' | 'Devolucoes' | 'Bonificacoes'

interface VendaAgregada {
  chave: string
  /** Quantidade × preço vendido, líquido de desconto — só vendas 2.2.40/2.2.41 */
  faturamentoBruto: number
  descontos: number
  /** descontos ÷ faturamentoBruto */
  descontosPct: number | null
  devolucoes: number
  bonificacoes: number
  /** total de unidades bonificadas */
  bonificacaoUnidades: number
  /** total de m³ bonificado */
  bonificacaoM3: number
  faturamentoLiquido: number
  vendasUN: number
  m3Total: number
  valorM3Vendido: number | null
  precoPonderado: number | null
  abaixoDoMinimo: boolean
  perdaEstimada: number
  /** "Faturamento Bruto Preço Base" — quantidade × preço base (tabela preço base quando bonificado=SIM), líquido de desconto, ainda SEM descontar devolução — só vendas 2.2.40/2.2.41 */
  faturamentoPrecoBase: number
  /** "Faturamento Líquido Preço Base" — faturamentoPrecoBase menos devolução (par líquido de faturamentoPrecoBase, mesma relação de faturamentoBruto→faturamentoLiquido) */
  faturamentoLiquidoPrecoBase: number
  /** Vendas + Bonificação − Devolução — "tudo que saiu da unidade", diferente de m3Total ("Volume Vendido", sem bonificação). */
  volumeExpedidoM3: number
}

interface DistribuidorCliente extends VendaAgregada {
  distribuidor: string
  cliente: string
}

interface VendaPorProduto extends VendaAgregada {
  distribuidor: string
  tipoProduto: string
  tabelaPreco: string
}

interface VendaPorProdutoEspecifico extends VendaAgregada {
  produto: string
  tabelaPreco: string
}

interface MesProduto {
  mes: string
  valorM3Vendido: number | null
  precoPonderado: number | null
  abaixoDoMinimo: boolean
}

interface ProdutoAoLongoDoTempo {
  produto: string
  faturamentoLiquido: number
  meses: MesProduto[]
  mesesComVenda: number
  mesesComPerda: number
  mesesOk: number
}

interface ClienteProduto extends VendaAgregada {
  cliente: string
  produto: string
}

interface ClienteProdutoNota extends VendaAgregada {
  cliente: string
  produto: string
  numeroMov: string
  data: string
}

interface ItemNota {
  produto: string
  tabelaPreco: string
  tipoMovimento: TipoMovimento
  quantidade: number
  precoVendido: number
  precoBase: number
  desconto: number
  valorBruto: number
  valorBase: number
  m3Total: number
  m3Minimo: number
  flagBonificacao: boolean
}

interface NotaFiscal extends VendaAgregada {
  numeroMov: string
  data: string
  distribuidor: string
  cliente: string
  tipoMovimento: TipoMovimento
  itens: ItemNota[]
}

interface ApiData {
  period: { from: string; to: string; toSolicitado: string }
  hoje: {
    data: string
    incluidoNoOficial: boolean
    totais: VendaAgregada | null
    numeroNotas: number
  } | null
  categoriasDisponiveis: string[]
  porCategoria: VendaAgregada[]
  clientesDisponiveis: string[]
  totalGeral: (VendaAgregada & { bonificacaoDoMes: number }) | null
  porDia: (VendaAgregada & Record<string, unknown>)[]
  porMes: (VendaAgregada & Record<string, unknown>)[]
  tiposVolume: string[]
  porTabelaPeriodo: VendaAgregada[]
  porSubTipoProdutoPeriodo: VendaAgregada[]
  insightMouraoPecas: {
    m3Mourao: number
    m3Pecas: number
    pctMourao: number
    pctPecas: number
    precoMouraoAtual: number
    precoPecasAtual: number
    metaBlend: number
    precoPecasMinimoNecessario: number
    precoMouraoMinimoNecessario: number
  } | null
  marcasDisponiveis: string[]
  porMarca: VendaAgregada[]
  insightDiametroMourao: InsightDiametroMourao | null
  porDistribuidor: VendaAgregada[]
  porDistribuidorCliente: DistribuidorCliente[]
  porDistribuidorClienteProduto: (DistribuidorCliente & { produto: string })[]
  distribuidoresSemVenda: string[]
  porProduto: VendaPorProduto[]
  porCliente: VendaAgregada[]
  porClienteProduto: ClienteProduto[]
  porClienteProdutoNota: ClienteProdutoNota[]
  porNota: NotaFiscal[]
  porProdutoEspecifico: VendaPorProdutoEspecifico[]
  produtosPorMes: ProdutoAoLongoDoTempo[]
  dispersaoPreco: DispersaoPreco[]
  abaixoTabela4: VendaAbaixoTabela4[]
  abaixoTabela4Total: { transacoes: number; valorPerdido: number }
  comparativoCotas: ComparativoCotasData | null
  linhasSemDados: boolean
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

interface TransacaoPreco {
  numeroMov: string
  data: string
  distribuidor: string
  cliente: string
  preco: number
}

interface DispersaoPreco {
  produto: string
  tabelaPreco: string
  n: number
  precoMin: number
  precoMax: number
  precoMedio: number
  variacaoPct: number
  notaMin: TransacaoPreco | null
  notaMax: TransacaoPreco | null
}

interface VendaAbaixoTabela4 {
  data: string
  distribuidor: string
  cliente: string
  produto: string
  tabelaPreco: string
  quantidade: number
  precoVendido: number
  precoMedioTabela4: number
  diferenca: number
  valorPerdido: number
}

function fmt(n: number | null, digits = 0): string {
  if (n == null) return '—'
  return n.toLocaleString('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: digits })
}
function fmtMoeda(n: number | null): string {
  if (n == null) return '—'
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 })
}
function fmtPct(n: number | null): string {
  if (n == null) return '—'
  return n.toLocaleString('pt-BR', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 })
}
/**
 * % que o R$/m³ realmente vendido representa da Meta de destino — pedido do
 * usuário 2026-08-24: "colocar o % que preço médio [é] para meta de
 * destino". Fração (não 0-100) pra compor direto com `fmtPct` acima; 100%
 * = bateu a meta exatamente, abaixo disso = vendeu abaixo do mínimo.
 */
function pctMeta(v: { valorM3Vendido: number | null; precoPonderado: number | null }): number | null {
  if (v.valorM3Vendido == null || v.precoPonderado == null || v.precoPonderado === 0) return null
  return v.valorM3Vendido / v.precoPonderado
}
/** 'YYYY-MM' -> 'MM/AAAA' */
function fmtMes(iso: string): string {
  const [ano, mes] = iso.split('-')
  if (!ano || !mes) return iso
  return `${mes}/${ano}`
}
/**
 * Detalhe por distribuidor e cliente para uma linha de "Produtos ao longo
 * do tempo" — pedido do usuário 2026-08-05: "na perda por produto
 * precisamos detalhar o distribuidor e cliente". Reaproveita
 * `porDistribuidorClienteProduto` (já calculado no servidor para o período
 * inteiro), filtrando pelo produto clicado — sem precisar de nova consulta.
 */
function renderProdutoDistribuidorCliente(produto: string, linhas: (DistribuidorCliente & { produto: string })[]) {
  const doProduto = linhas.filter((l) => l.produto === produto).sort((a, b) => b.faturamentoLiquido - a.faturamentoLiquido)
  if (!doProduto.length) return <p className="text-xs text-slate-500">Sem detalhe por distribuidor/cliente.</p>
  return (
    <table className="w-full text-xs">
      <thead className="text-left text-slate-500">
        <tr>
          <th className="px-2 py-1">Distribuidor</th>
          <th className="px-2 py-1">Cliente</th>
          <th className="px-2 py-1 text-right">Faturamento líquido</th>
          <th className="px-2 py-1 text-right">R$/m³</th>
          <th className="px-2 py-1 text-right">Mínimo</th>
          <th className="px-2 py-1"></th>
        </tr>
      </thead>
      <tbody>
        {doProduto.map((l) => (
          <tr key={`${l.distribuidor}|${l.cliente}`} className="border-t border-slate-100">
            <td className="px-2 py-1">{l.distribuidor}</td>
            <td className="px-2 py-1">{l.cliente}</td>
            <td className="px-2 py-1 text-right">{fmtMoeda(l.faturamentoLiquido)}</td>
            <td className="px-2 py-1 text-right">{fmtMoeda(l.valorM3Vendido)}</td>
            <td className="px-2 py-1 text-right">{fmtMoeda(l.precoPonderado)}</td>
            <td className="px-2 py-1">
              {l.valorM3Vendido != null &&
                (l.abaixoDoMinimo ? (
                  <span className="rounded bg-red-100 px-1.5 py-0.5 font-medium text-red-700">abaixo do mínimo ({fmtPct(pctMeta(l))})</span>
                ) : (
                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-800">dentro do mínimo ({fmtPct(pctMeta(l))})</span>
                ))}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** 'YYYY-MM-DD' -> 'DD/MM' — compacto para eixo de gráfico diário. */
function fmtDia(iso: string): string {
  const [, mes, dia] = iso.split('-')
  if (!mes || !dia) return iso
  return `${dia}/${mes}`
}
/**
 * Contagem de dias acima/abaixo da meta (pedido do usuário 2026-08-05:
 * "colocar no gráfico quantos dias fiquei acima e quantos abaixo da média")
 * — "média" aqui é o R$/m³ realizado do dia comparado contra o mínimo
 * ponderado (a meta) daquele mesmo dia; dias sem m³ vendido não contam.
 */
function contarDiasAcimaAbaixo(porDia: VendaAgregada[]): { acima: number; abaixo: number } {
  let acima = 0
  let abaixo = 0
  for (const d of porDia) {
    if (d.valorM3Vendido == null || d.precoPonderado == null) continue
    if (d.valorM3Vendido >= d.precoPonderado) acima++
    else abaixo++
  }
  return { acima, abaixo }
}

function monthStart(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}
function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Card do resumo financeiro (pedido do usuário 2026-08-13): valor + fórmula descritiva, clicável para cross-filtrar por tipo de movimento. */
function CardFinanceiro({
  label,
  formula,
  valor,
  valorClassName = '',
  sub,
  subClassName = 'text-slate-500',
  ativo,
  onClick,
}: {
  label: string
  formula: string
  valor: string
  valorClassName?: string
  sub?: string
  subClassName?: string
  ativo: boolean
  onClick: (ctrl: boolean) => void
}) {
  return (
    <button
      type="button"
      onClick={(e) => onClick(e.ctrlKey || e.metaKey)}
      className={`rounded-xl border p-4 text-left transition-colors ${ativo ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 bg-white hover:border-emerald-300'}`}
    >
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-lg font-semibold ${valorClassName}`}>{valor}</p>
      <p className="mt-1 text-[11px] leading-snug text-slate-400">{formula}</p>
      {sub && <p className={`mt-0.5 text-xs font-medium ${subClassName}`}>{sub}</p>}
    </button>
  )
}

/**
 * Fase 3 — Produção e Venda de Madeira Tratada: análise de perda de preço,
 * migrada do Power BI "Planep_Faturamento_New" (pedido do usuário
 * 2026-08-03: "entender possíveis perdas em valor de venda de produtos,
 * entender onde está o valor e a condição"). Compara o valor/m³ realmente
 * vendido contra o preço mínimo esperado (ICMS × tipo de produto), por
 * distribuidor — a mesma lógica das medidas `.Valor M3 Vendido` /
 * `.ValorminM3` / `.IndicadorPrecoMedio` do relatório original.
 */
type Aba = 'tatico' | 'estrategico' | 'nota' | 'diario' | 'bonificacoes' | 'melhorcarga' | 'clientes' | 'potenciais' | 'critica'

const ABA_LABEL: Record<Aba, string> = {
  tatico: 'Análise por período',
  estrategico: 'Painel estratégico (ano)',
  nota: 'Por Nota Fiscal',
  diario: 'Relatório D-1',
  bonificacoes: 'Bonificações',
  melhorcarga: 'Melhor carga',
  clientes: 'Clientes',
  potenciais: 'Clientes potenciais',
  critica: 'Crítica ao modelo',
}

type SubAba = 'cliente' | 'produto' | 'tempo' | 'dispersao' | 'abaixoTabela'

const SUB_ABA_LABEL: Record<SubAba, string> = {
  cliente: 'Por cliente',
  produto: 'Por produto específico',
  tempo: 'Produto ao longo do tempo',
  dispersao: 'Dispersão de preço',
  abaixoTabela: 'Abaixo da tabela preço base',
}

export function Fase3Dashboard() {
  const [aba, setAba] = useState<Aba>('tatico')
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(todayStr())
  const [categorias, setCategorias] = useState<string[]>([CATEGORIA_PADRAO])
  const [marcas, setMarcas] = useState<string[]>([])
  const [distribuidores, setDistribuidores] = useState<string[]>([])
  const [clienteFiltro, setClienteFiltro] = useState<string | null>(null)
  const [data, setData] = useState<ApiData | null>(null)
  const [loading, setLoading] = useState(true)
  const [produtosExpandidos, setProdutosExpandidos] = useState<Set<string>>(new Set())
  const [clienteProdutosExpandidos, setClienteProdutosExpandidos] = useState<Set<string>>(new Set())
  // Cards clicáveis (pedido do usuário 2026-08-05: "os cards precisam estar
  // nas abas de análise por período e no estratégico com os mesmos
  // conceitos") — mesmo comportamento do painel estratégico: clique troca a
  // seleção, Ctrl/Cmd+clique adiciona/remove sem mexer nos outros.
  const [tabelasFiltro, setTabelasFiltro] = useState<Set<string>>(new Set())
  const [subTiposFiltro, setSubTiposFiltro] = useState<Set<string>>(new Set())
  // Cards do resumo financeiro (pedido do usuário 2026-08-13): clicar em
  // Bruto/Bonificação/Devolução filtra a tela inteira para só aquele tipo de
  // movimento — mesmo comportamento de clique/Ctrl+clique dos demais cards.
  const [tipoMovimentoFiltro, setTipoMovimentoFiltro] = useState<Set<string>>(new Set())
  // Pedido do usuário 2026-08-21: "colocar em abas" as tabelas de detalhe
  // (cliente, produto específico, produto ao longo do tempo, dispersão de
  // preço, abaixo da tabela4) — antes empilhadas uma sobre a outra, exigindo
  // muita rolagem; agora só uma é renderizada por vez, escolhida por este
  // sub-menu (independente das abas principais de cima).
  const [subAba, setSubAba] = useState<SubAba>('cliente')
  // Pedido do usuário 2026-08-21: na Dispersão de preço, clicar na nota do
  // maior/menor preço já abre ela na aba "Por Nota Fiscal" — estreita o
  // período pro dia da nota (senão ela pode ficar fora do recorte atual) e
  // guarda o número da NF pra filtrar/auto-expandir só ela lá.
  const [notaFiscalFoco, setNotaFiscalFoco] = useState<string | null>(null)
  function abrirNotaFiscal(t: TransacaoPreco) {
    setFrom(t.data)
    setTo(t.data)
    setNotaFiscalFoco(t.numeroMov)
    setAba('nota')
  }

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
    const tabelasParam = tabelasFiltro.size ? `&tabelas=${encodeURIComponent([...tabelasFiltro].join(','))}` : ''
    const subTiposParam = subTiposFiltro.size ? `&subtipos=${encodeURIComponent([...subTiposFiltro].join(','))}` : ''
    const clienteParam = clienteFiltro ? `&cliente=${encodeURIComponent(clienteFiltro)}` : ''
    const marcasParam = marcas.length ? `&marcas=${encodeURIComponent(marcas.join(','))}` : ''
    const distribuidoresParam = distribuidores.length ? `&distribuidores=${encodeURIComponent(distribuidores.join(','))}` : ''
    const tipoMovimentoParam = tipoMovimentoFiltro.size ? `&tipoMovimento=${encodeURIComponent([...tipoMovimentoFiltro].join(','))}` : ''
    fetch(
      `/api/fase3/data?from=${from}&to=${to}&categorias=${encodeURIComponent(categorias.join(','))}${tabelasParam}${subTiposParam}${clienteParam}${marcasParam}${distribuidoresParam}${tipoMovimentoParam}`,
    )
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false))
  }, [from, to, categorias, tabelasFiltro, subTiposFiltro, clienteFiltro, marcas, distribuidores, tipoMovimentoFiltro])

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <h1 className="text-xl font-semibold">Fase 3 — Venda de Madeira Tratada</h1>
        <p className="mt-1 text-sm text-slate-500">
          Perda de preço: valor por m³ realmente vendido comparado ao preço mínimo esperado (ICMS do
          estado × tipo de produto), por distribuidor.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-200 print:hidden">
        {(['tatico', 'estrategico', 'nota', 'diario', 'bonificacoes', 'melhorcarga', 'clientes', 'potenciais', 'critica'] as Aba[]).map((a) => (
          <button
            key={a}
            onClick={() => setAba(a)}
            className={`-mb-px rounded-t-md border border-b-0 px-4 py-2 text-sm font-medium transition-colors ${aba === a ? 'border-slate-200 bg-emerald-700 text-white shadow-sm' : 'border-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-700'}`}
          >
            {ABA_LABEL[a]}
          </button>
        ))}
      </div>

      {aba === 'estrategico' ? (
        <PainelEstrategico />
      ) : aba === 'nota' ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
            <DateRangeInputs from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
          </div>
          {/* Pedido do usuário 2026-08-21: "na aba por nota fiscal preciso de
              um filtro por categoria de produto" — mesmo controle usado nas
              outras abas (categorias/marca já filtram `data.porNota` no
              backend, mas o controle só aparecia nas outras abas, deixando o
              filtro "invisível" aqui mesmo quando já estava aplicado). */}
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
          </div>
          <p className="text-xs text-slate-500">
            Uma linha por nota fiscal, com as mesmas fórmulas do resumo financeiro aplicadas só àquela NF — clique para
            abrir os itens (produto a produto) e conferir quantidade × preço, desconto e m³ contra a fonte.
          </p>
          {notaFiscalFoco && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
              Mostrando só a NF <strong>{notaFiscalFoco}</strong> (aberta a partir da Dispersão de preço).
              <button type="button" onClick={() => setNotaFiscalFoco(null)} className="ml-auto rounded bg-white px-2 py-0.5 font-medium text-emerald-800 hover:bg-emerald-100">
                Ver todas as notas
              </button>
            </div>
          )}
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-4 py-3 font-medium">Por nota fiscal ({data?.porNota.length ?? 0})</div>
            <SortableTable
              columns={[
                { key: 'numeroMov', label: 'NF', sortValue: (n: NotaFiscal) => n.numeroMov, render: (n) => <span className="font-medium">{n.numeroMov || '—'}</span> },
                { key: 'data', label: 'Data', sortValue: (n: NotaFiscal) => n.data, render: (n) => (n.data ? fmtDateBR(n.data) : '—') },
                {
                  key: 'tipoMovimento',
                  label: 'Tipo',
                  sortValue: (n: NotaFiscal) => n.tipoMovimento,
                  render: (n) => (
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${
                        n.tipoMovimento === 'Devolucoes'
                          ? 'bg-rose-100 text-rose-700'
                          : n.tipoMovimento === 'Bonificacoes'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {n.tipoMovimento === 'Devolucoes' ? 'Devolução' : n.tipoMovimento === 'Bonificacoes' ? 'Bonificação' : 'Venda'}
                    </span>
                  ),
                },
                { key: 'distribuidor', label: 'Distribuidor', sortValue: (n: NotaFiscal) => n.distribuidor, render: (n) => n.distribuidor },
                { key: 'cliente', label: 'Cliente', sortValue: (n: NotaFiscal) => n.cliente, render: (n) => n.cliente },
                { key: 'vendasUN', label: 'Quantidade (un)', align: 'right', sortValue: (n: NotaFiscal) => n.vendasUN, render: (n) => fmt(n.vendasUN, 0) },
                { key: 'faturamentoBruto', label: 'Faturamento Bruto', align: 'right', sortValue: (n: NotaFiscal) => n.faturamentoBruto, render: (n) => fmtMoeda(n.faturamentoBruto) },
                { key: 'descontos', label: 'Descontos', align: 'right', sortValue: (n: NotaFiscal) => n.descontos, render: (n) => fmtMoeda(n.descontos) },
                { key: 'devolucoes', label: 'Devolução', align: 'right', sortValue: (n: NotaFiscal) => n.devolucoes, render: (n) => fmtMoeda(n.devolucoes) },
                { key: 'bonificacaoUnidades', label: 'Bonif. (un)', align: 'right', sortValue: (n: NotaFiscal) => n.bonificacaoUnidades, render: (n) => fmt(n.bonificacaoUnidades, 0) },
                { key: 'bonificacaoM3', label: 'Bonif. (m³)', align: 'right', sortValue: (n: NotaFiscal) => n.bonificacaoM3, render: (n) => fmt(n.bonificacaoM3, 2) },
                { key: 'faturamentoLiquido', label: 'Faturamento Líquido', align: 'right', sortValue: (n: NotaFiscal) => n.faturamentoLiquido, render: (n) => fmtMoeda(n.faturamentoLiquido) },
                { key: 'faturamentoPrecoBase', label: 'Faturamento Bruto Preço Base', align: 'right', sortValue: (n: NotaFiscal) => n.faturamentoPrecoBase, render: (n) => fmtMoeda(n.faturamentoPrecoBase) },
                { key: 'faturamentoLiquidoPrecoBase', label: 'Faturamento Líquido Preço Base', align: 'right', sortValue: (n: NotaFiscal) => n.faturamentoLiquidoPrecoBase, render: (n) => fmtMoeda(n.faturamentoLiquidoPrecoBase) },
                { key: 'm3Total', label: 'm³ vendido', align: 'right', sortValue: (n: NotaFiscal) => n.m3Total, render: (n) => fmt(n.m3Total, 2) },
                { key: 'volumeExpedidoM3', label: 'Volume expedido', align: 'right', sortValue: (n: NotaFiscal) => n.volumeExpedidoM3, render: (n) => fmt(n.volumeExpedidoM3, 2) },
                { key: 'valorM3Vendido', label: 'R$/m³ vendido', align: 'right', sortValue: (n: NotaFiscal) => n.valorM3Vendido ?? 0, render: (n) => fmtMoeda(n.valorM3Vendido) },
                { key: 'precoPonderado', label: 'Meta de destino', align: 'right', sortValue: (n: NotaFiscal) => n.precoPonderado ?? 0, render: (n) => fmtMoeda(n.precoPonderado) },
                {
                  key: 'situacao',
                  label: 'Situação',
                  sortValue: (n: NotaFiscal) => (n.abaixoDoMinimo ? 0 : 1),
                  render: (n) =>
                    n.valorM3Vendido == null ? (
                      <span className="text-slate-400">sem m³</span>
                    ) : n.abaixoDoMinimo ? (
                      <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">abaixo do mínimo ({fmtPct(pctMeta(n))})</span>
                    ) : (
                      <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">dentro do mínimo ({fmtPct(pctMeta(n))})</span>
                    ),
                },
              ]}
              rows={notaFiscalFoco ? (data?.porNota ?? []).filter((n) => n.numeroMov === notaFiscalFoco) : data?.porNota ?? []}
              rowKey={(n) => n.numeroMov}
              defaultSortKey="data"
              autoExpandKeys={notaFiscalFoco ? [notaFiscalFoco] : []}
              wrapHeaders
              emptyMessage={
                notaFiscalFoco
                  ? `NF ${notaFiscalFoco} não está no período selecionado.`
                  : 'Nenhuma nota fiscal no período.'
              }
              renderFooter={(linhas: NotaFiscal[]) => {
                const soma = (f: (n: NotaFiscal) => number) => linhas.reduce((s, n) => s + f(n), 0)
                const totalM3 = soma((n) => n.m3Total)
                const totalLiquidoBase = soma((n) => n.faturamentoLiquidoPrecoBase)
                const valorM3Total = totalM3 > 0 ? totalLiquidoBase / totalM3 : null
                return (
                  <>
                    <td className="px-3 py-2">Total ({linhas.length})</td>
                    <td className="px-3 py-2" colSpan={4} />
                    <td className="px-3 py-2 text-right">{fmt(soma((n) => n.vendasUN), 0)}</td>
                    <td className="px-3 py-2 text-right">{fmtMoeda(soma((n) => n.faturamentoBruto))}</td>
                    <td className="px-3 py-2 text-right">{fmtMoeda(soma((n) => n.descontos))}</td>
                    <td className="px-3 py-2 text-right">{fmtMoeda(soma((n) => n.devolucoes))}</td>
                    <td className="px-3 py-2 text-right">{fmt(soma((n) => n.bonificacaoUnidades), 0)}</td>
                    <td className="px-3 py-2 text-right">{fmt(soma((n) => n.bonificacaoM3), 2)}</td>
                    <td className="px-3 py-2 text-right">{fmtMoeda(soma((n) => n.faturamentoLiquido))}</td>
                    <td className="px-3 py-2 text-right">{fmtMoeda(soma((n) => n.faturamentoPrecoBase))}</td>
                    <td className="px-3 py-2 text-right">{fmtMoeda(totalLiquidoBase)}</td>
                    <td className="px-3 py-2 text-right">{fmt(totalM3, 2)}</td>
                    <td className="px-3 py-2 text-right">{fmt(soma((n) => n.volumeExpedidoM3), 2)}</td>
                    <td className="px-3 py-2 text-right">{fmtMoeda(valorM3Total)}</td>
                    <td className="px-3 py-2" colSpan={2} />
                  </>
                )
              }}
              renderExpanded={(n) => (
                <table className="w-full text-xs">
                  <thead className="text-left text-slate-500">
                    <tr>
                      <th className="py-1 pl-2">Produto</th>
                      <th className="py-1">Tabela</th>
                      <th className="py-1 text-right">Quantidade</th>
                      <th className="py-1 text-right">Preço vendido</th>
                      <th className="py-1 text-right">Preço base</th>
                      <th className="py-1 text-right">Desconto</th>
                      <th className="py-1 text-right">Valor bruto</th>
                      <th className="py-1 text-right">Valor base</th>
                      <th className="py-1 text-right">m³</th>
                      <th className="py-1 text-right">m³ mínimo</th>
                      <th className="py-1 text-center">Bonificado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {n.itens.map((it, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="py-1 pl-2">{it.produto}</td>
                        <td className="py-1 text-slate-600">{it.tabelaPreco}</td>
                        <td className="py-1 text-right">{fmt(it.quantidade, 2)}</td>
                        <td className="py-1 text-right">{fmtMoeda(it.precoVendido)}</td>
                        <td className="py-1 text-right">{fmtMoeda(it.precoBase)}</td>
                        <td className="py-1 text-right">{fmtMoeda(it.desconto)}</td>
                        <td className="py-1 text-right">{fmtMoeda(it.valorBruto)}</td>
                        <td className="py-1 text-right">{fmtMoeda(it.valorBase)}</td>
                        <td className="py-1 text-right">{fmt(it.m3Total, 2)}</td>
                        <td className="py-1 text-right">{fmt(it.m3Minimo, 2)}</td>
                        <td className="py-1 text-center">{it.flagBonificacao ? 'SIM' : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            />
          </div>
        </div>
      ) : aba === 'diario' ? (
        <RelatorioDiaTab />
      ) : aba === 'bonificacoes' ? (
        <BonificacoesTab />
      ) : aba === 'melhorcarga' ? (
        <MelhorCargaTab />
      ) : aba === 'clientes' ? (
        <ClientesTab />
      ) : aba === 'potenciais' ? (
        <ClientesPotenciaisTab />
      ) : aba === 'critica' ? (
        <CriticaModeloTab />
      ) : (
        <>
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <DateRangeInputs from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
        {loading && <span className="text-xs text-slate-500">carregando…</span>}
        {data?.period && (
          <span className="text-xs text-slate-500">
            Período: {fmtDateBR(data.period.from)} a {fmtDateBR(data.period.to)}
          </span>
        )}
        {data?.period && data.period.to !== data.period.toSolicitado && (
          <span className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900">
            Comparativo oficial até {fmtDateBR(data.period.to)} — hoje ({fmtDateBR(data.period.toSolicitado)}) ainda não
            entrou (dados do dia só fecham às 18h). Ver acompanhamento do dia abaixo.
          </span>
        )}
      </div>

      {data?.hoje && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-medium">Hoje ({fmtDateBR(data.hoje.data)}) — acompanhamento</p>
            <span className={`text-xs ${data.hoje.incluidoNoOficial ? 'text-emerald-700' : 'text-amber-700'}`}>
              {data.hoje.incluidoNoOficial ? 'já incluído no comparativo oficial' : 'ainda não incluído no comparativo oficial'}
            </span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs text-slate-500">Faturamento líquido hoje</p>
              <p className="font-semibold">{fmtMoeda(data.hoje.totais?.faturamentoLiquido ?? null)}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs text-slate-500">m³ vendido hoje</p>
              <p className="font-semibold">{fmt(data.hoje.totais?.m3Total ?? 0, 1)}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs text-slate-500">Notas fiscais hoje</p>
              <p className="font-semibold">{fmt(data.hoje.numeroNotas, 0)}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs text-slate-500">R$/m³ vendido hoje</p>
              <p className="font-semibold">{fmtMoeda(data.hoje.totais?.valorM3Vendido ?? null)}</p>
            </div>
          </div>
        </div>
      )}

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
          Nenhum dado sincronizado ainda para este período — o dataset "Vendas de madeira tratada"
          precisa rodar ao menos uma sincronização (Cadastros → Fontes de Dados).
        </div>
      )}

      {/* Resumo financeiro — pedido do usuário 2026-08-13: "análise mais
          criteriosa... cards com todas as métricas e nos cards colocar o
          cálculo". Linha 1 (Bruto/Descontos/Bonificação/Devolução) é
          clicável: filtra a tela inteira para só aquele tipo de movimento
          (Ctrl/Cmd+clique combina mais de um), mesmo padrão de cross-
          filtragem dos demais cards/gráficos. Linha 2 é sempre a visão
          consolidada (todos os movimentos juntos) — clicar nela limpa o
          filtro de movimento. */}
      <div>
        <p className="mb-2 text-xs font-medium text-slate-600">
          Resumo financeiro{tipoMovimentoFiltro.size > 0 && <span className="text-emerald-700"> — filtrado por {[...tipoMovimentoFiltro].join(' + ')}</span>}
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <CardFinanceiro
            label="Faturamento Bruto"
            formula="Quantidade × preço vendido — só vendas 2.2.40/2.2.41"
            valor={fmtMoeda(data?.totalGeral?.faturamentoBruto ?? null)}
            ativo={tipoMovimentoFiltro.has('Vendas')}
            onClick={(ctrl) => toggleSelecao(tipoMovimentoFiltro, setTipoMovimentoFiltro, 'Vendas', ctrl)}
          />
          <CardFinanceiro
            label="Total de Descontos"
            formula="Desconto lançado nas vendas normais"
            valor={fmtMoeda(data?.totalGeral?.descontos ?? null)}
            sub={
              data?.totalGeral?.descontosPct != null
                ? `${fmtPct(data.totalGeral.descontosPct)} do faturamento bruto`
                : undefined
            }
            ativo={tipoMovimentoFiltro.has('Vendas')}
            onClick={(ctrl) => toggleSelecao(tipoMovimentoFiltro, setTipoMovimentoFiltro, 'Vendas', ctrl)}
          />
          <CardFinanceiro
            label="Bonificação"
            formula="Total de unidades e m³ bonificado"
            valor={`${fmt(data?.totalGeral?.bonificacaoUnidades ?? null, 0)} un`}
            sub={`${fmt(data?.totalGeral?.bonificacaoM3 ?? null, 1)} m³`}
            ativo={tipoMovimentoFiltro.has('Bonificacoes')}
            onClick={(ctrl) => toggleSelecao(tipoMovimentoFiltro, setTipoMovimentoFiltro, 'Bonificacoes', ctrl)}
          />
          <CardFinanceiro
            label="Total de Devolução"
            formula="Quantidade × preço vendido nos movimentos de devolução"
            valor={fmtMoeda(data?.totalGeral?.devolucoes ?? null)}
            ativo={tipoMovimentoFiltro.has('Devolucoes')}
            onClick={(ctrl) => toggleSelecao(tipoMovimentoFiltro, setTipoMovimentoFiltro, 'Devolucoes', ctrl)}
          />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <CardFinanceiro
            label="Faturamento Líquido"
            formula="Faturamento Bruto − descontos − devolução"
            valor={fmtMoeda(data?.totalGeral?.faturamentoLiquido ?? null)}
            ativo={tipoMovimentoFiltro.size === 0}
            onClick={() => setTipoMovimentoFiltro(new Set())}
          />
          <CardFinanceiro
            label="Faturamento Bruto Preço Base"
            formula="Quantidade × preço base — só vendas 2.2.40/2.2.41"
            valor={fmtMoeda(data?.totalGeral?.faturamentoPrecoBase ?? null)}
            ativo={tipoMovimentoFiltro.size === 0}
            onClick={() => setTipoMovimentoFiltro(new Set())}
          />
          <CardFinanceiro
            label="Faturamento Líquido Preço Base"
            formula="Faturamento Bruto Preço Base − descontos − devolução"
            valor={fmtMoeda(data?.totalGeral?.faturamentoLiquidoPrecoBase ?? null)}
            ativo={tipoMovimentoFiltro.size === 0}
            onClick={() => setTipoMovimentoFiltro(new Set())}
          />
          <CardFinanceiro
            label="Bonificação do mês"
            formula="(Líquido − Base × parâmetro) nas linhas bonificado=SIM"
            valor={fmtMoeda(data?.totalGeral?.bonificacaoDoMes ?? null)}
            ativo={tipoMovimentoFiltro.size === 0}
            onClick={() => setTipoMovimentoFiltro(new Set())}
          />
          <CardFinanceiro
            label="Volume Vendido"
            formula="Toda venda, exceto bonificação, descontando a devolução"
            valor={`${fmt(data?.totalGeral?.m3Total ?? null, 1)} m³`}
            ativo={tipoMovimentoFiltro.size === 0}
            onClick={() => setTipoMovimentoFiltro(new Set())}
          />
          <CardFinanceiro
            label="Volume Expedido"
            formula="Tudo que saiu da unidade (venda + bonificação), descontando a devolução"
            valor={`${fmt(data?.totalGeral?.volumeExpedidoM3 ?? null, 1)} m³`}
            ativo={tipoMovimentoFiltro.size === 0}
            onClick={() => setTipoMovimentoFiltro(new Set())}
          />
          <CardFinanceiro
            label="Valor R$/m³ vendido"
            formula="Faturamento líquido (preço base) ÷ volume vendido"
            valor={fmtMoeda(data?.totalGeral?.valorM3Vendido ?? null)}
            valorClassName={data?.totalGeral?.abaixoDoMinimo ? 'text-red-700' : ''}
            ativo={tipoMovimentoFiltro.size === 0}
            onClick={() => setTipoMovimentoFiltro(new Set())}
          />
          <CardFinanceiro
            label="Meta de destino"
            formula="Preço mínimo médio, ponderado pelo mix (m³) efetivamente vendido"
            valor={fmtMoeda(data?.totalGeral?.precoPonderado ?? null)}
            sub={data?.totalGeral?.abaixoDoMinimo ? '⚠ abaixo do mínimo no geral' : undefined}
            subClassName="text-red-700"
            ativo={tipoMovimentoFiltro.size === 0}
            onClick={() => setTipoMovimentoFiltro(new Set())}
          />
        </div>
      </div>

      {/* Pedido do usuário 2026-08-05: "análise por período montar um
          gráfico por dia da média e do ponderado" + "colocar uma barra de
          volume vendido por dia, barra empilhada por cor por tipo" + "queria
          que fosse inserido no mesmo gráfico com uma segunda série/escala ao
          invés de criação de um segundo gráfico" — um único gráfico
          combinado: barras empilhadas de m³ por TipoProduto no eixo direito,
          linhas de R$/m³ (realizado x meta) no eixo esquerdo. Nota: isto é
          um eixo duplo de propósito, a pedido explícito do usuário — a regra
          padrão da skill dataviz (nunca dual-axis) foi conscientemente
          deixada de lado aqui. */}
      {(data?.porDia?.length ?? 0) > 1 && (() => {
        // Pedido do usuário 2026-08-21: "quando colocar vários meses agrupar
        // por mês" — um período de muitos meses vira uma parede ilegível de
        // barras diárias; com mais de 1 mês no recorte, o gráfico agrega por
        // mês em vez de por dia. Clicar num mês estreita o período pra
        // aquele mês (na próxima renderização `multiMes` vira false e o
        // MESMO gráfico volta a mostrar dia a dia — é o "drill" pedido, sem
        // precisar de um botão/estado extra). Ctrl/Cmd+clique NÃO troca de
        // mês, ESTENDE o período atual para incluir aquele mês também
        // (o filtro continua sendo um único intervalo contínuo — meses
        // "pulados" no meio entram junto, já que o painel não filtra por
        // meses avulsos).
        const multiMes = (data?.porMes?.length ?? 0) > 1
        const dadosGrafico = multiMes ? data?.porMes ?? [] : data?.porDia ?? []
        const { acima, abaixo } = contarDiasAcimaAbaixo(dadosGrafico as VendaAgregada[])
        return (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium text-slate-600">
              {multiMes ? 'Evolução mensal' : 'Evolução diária'} — volume por tipo (m³, barras) x R$/m³ vendido x mínimo
              ponderado (linhas).{' '}
              {multiMes
                ? 'Clique num mês para abrir o detalhe dia a dia daquele mês (Ctrl/Cmd+clique estende o período até aquele mês).'
                : 'Inclui hoje (sem afetar as médias) — clique num dia para filtrar só ele e investigar o que impactou o resultado.'}
            </p>
            {acima + abaixo > 0 && (
              <p className="text-xs">
                <span className="rounded bg-emerald-100 px-2 py-0.5 font-medium text-emerald-800">
                  {acima} {multiMes ? 'meses' : 'dias'} acima da meta
                </span>
                {' · '}
                <span className="rounded bg-red-100 px-2 py-0.5 font-medium text-red-700">
                  {abaixo} {multiMes ? 'meses' : 'dias'} abaixo da meta
                </span>
              </p>
            )}
          </div>
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart
              data={dadosGrafico}
              margin={{ top: 4, right: 8, left: -8, bottom: 0 }}
              className="cursor-pointer"
              onClick={(e, event) => {
                const chave = e?.activeLabel as string | undefined
                if (!chave) return
                if (multiMes) {
                  const [ano, mesNum] = chave.split('-').map(Number)
                  const inicioMes = `${chave}-01`
                  const fimMes = new Date(ano, mesNum, 0).toISOString().slice(0, 10)
                  if (event?.ctrlKey || event?.metaKey) {
                    setFrom((f) => (inicioMes < f ? inicioMes : f))
                    setTo((t) => (fimMes > t ? fimMes : t))
                  } else {
                    setFrom(inicioMes)
                    setTo(fimMes)
                  }
                } else {
                  setFrom(chave)
                  setTo(chave)
                }
              }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="chave" tickFormatter={multiMes ? fmtMes : fmtDia} tick={{ fontSize: 11 }} />
              <YAxis
                yAxisId="volume"
                orientation="right"
                tick={{ fontSize: 11 }}
                tickFormatter={(v) => fmt(Number(v), 0)}
                label={{ value: 'm³', position: 'insideTopRight', fontSize: 11, fill: '#64748b' }}
              />
              <YAxis
                yAxisId="preco"
                orientation="left"
                tick={{ fontSize: 11 }}
                tickFormatter={(v) => fmtMoeda(Number(v))}
                label={{ value: 'R$/m³', position: 'insideTopLeft', fontSize: 11, fill: '#64748b' }}
              />
              <Tooltip
                labelFormatter={(v) => (multiMes ? fmtMes(String(v)) : fmtDateBR(String(v)))}
                formatter={(v, name) => {
                  const numero = v == null ? null : Number(v)
                  const ehVolume = (data?.tiposVolume ?? []).includes(String(name))
                  return [ehVolume ? `${fmt(numero, 1)} m³` : fmtMoeda(numero), String(name)]
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {(data?.tiposVolume ?? []).map((tipo) => (
                <Bar key={tipo} yAxisId="volume" dataKey={tipo} name={tipo} stackId="volume" fill={corTipoProduto(tipo)} />
              ))}
              <Line yAxisId="preco" type="monotone" dataKey="valorM3Vendido" name="R$/m³ vendido (realizado)" stroke={COR_REALIZADO} strokeWidth={2} dot={{ r: 2 }} connectNulls />
              <Line yAxisId="preco" type="monotone" dataKey="precoPonderado" name="Meta de destino" stroke={COR_META} strokeWidth={2} strokeDasharray="4 3" dot={{ r: 2 }} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        )
      })()}

      {/* Pedido do usuário 2026-08-05: "os cards precisam estar nas abas de
          análise por período e no estratégico com os mesmos conceitos" —
          mesmos cards de ICMS/Mourão-Peças/insight do painel estratégico,
          clicáveis (Ctrl para multi-seleção) e vermelho quando abaixo da meta. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {(data?.porTabelaPeriodo ?? []).map((t) => {
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

      {(data?.porSubTipoProdutoPeriodo?.length ?? 0) > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="mb-2 text-xs font-medium text-slate-600">Mourão x Peças — proporção e preço médio do m³</p>
            <div className="grid grid-cols-2 gap-3">
              {(data?.porSubTipoProdutoPeriodo ?? []).map((s) => {
                const m3TotalMix = (data?.porSubTipoProdutoPeriodo ?? []).reduce((acc, x) => acc + x.m3Total, 0)
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

      <ComparativoCotas
        data={data?.comparativoCotas}
        periodoLabel={data?.period ? `${fmtDateBR(data.period.from)} a ${fmtDateBR(data.period.to)}` : 'o período selecionado'}
      />

      <TabelaDistribuidores
        titulo="Por distribuidor"
        porDistribuidor={data?.porDistribuidor ?? []}
        porDistribuidorCliente={data?.porDistribuidorCliente ?? []}
        porDistribuidorClienteProduto={data?.porDistribuidorClienteProduto ?? []}
        distribuidoresSemVenda={data?.distribuidoresSemVenda ?? []}
      />

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3 font-medium">
          Por distribuidor × tipo de produto × tabela de ICMS ({data?.porProduto.length ?? 0})
        </div>
        <SortableTable
          columns={[
            { key: 'distribuidor', label: 'Distribuidor', sortValue: (p: VendaPorProduto) => p.distribuidor, render: (p) => <span className="font-medium">{p.distribuidor}</span> },
            { key: 'tipoProduto', label: 'Tipo de produto', sortValue: (p: VendaPorProduto) => p.tipoProduto, render: (p) => p.tipoProduto },
            { key: 'tabelaPreco', label: 'Tabela', sortValue: (p: VendaPorProduto) => p.tabelaPreco, render: (p) => <span className="text-xs text-slate-600">{p.tabelaPreco}</span> },
            { key: 'faturamentoLiquido', label: 'Faturamento líquido', align: 'right', sortValue: (p: VendaPorProduto) => p.faturamentoLiquido, render: (p) => fmtMoeda(p.faturamentoLiquido) },
            { key: 'vendasUN', label: 'Quantidade (un)', align: 'right', sortValue: (p: VendaPorProduto) => p.vendasUN, render: (p) => fmt(p.vendasUN, 0) },
            { key: 'm3Total', label: 'm³ vendido', align: 'right', sortValue: (p: VendaPorProduto) => p.m3Total, render: (p) => fmt(p.m3Total, 1) },
            { key: 'valorM3Vendido', label: 'R$/m³ vendido', align: 'right', sortValue: (p: VendaPorProduto) => p.valorM3Vendido ?? 0, render: (p) => fmtMoeda(p.valorM3Vendido) },
            { key: 'precoPonderado', label: 'Meta de destino', align: 'right', sortValue: (p: VendaPorProduto) => p.precoPonderado ?? 0, render: (p) => fmtMoeda(p.precoPonderado) },
            {
              key: 'situacao',
              label: 'Situação',
              sortValue: (p: VendaPorProduto) => (p.abaixoDoMinimo ? 0 : 1),
              render: (p) =>
                p.valorM3Vendido == null ? (
                  <span className="text-slate-400">sem m³</span>
                ) : p.abaixoDoMinimo ? (
                  <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">abaixo do mínimo ({fmtPct(pctMeta(p))})</span>
                ) : (
                  <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">dentro do mínimo ({fmtPct(pctMeta(p))})</span>
                ),
            },
          ]}
          rows={data?.porProduto ?? []}
          rowKey={(p) => p.chave}
          defaultSortKey="faturamentoLiquido"
          emptyMessage="Nenhuma venda no período."
        />
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-200">
        {(Object.keys(SUB_ABA_LABEL) as SubAba[]).map((sa) => (
          <button
            key={sa}
            onClick={() => setSubAba(sa)}
            className={`-mb-px rounded-t-md border border-b-0 px-3 py-1.5 text-xs font-medium transition-colors ${subAba === sa ? 'border-slate-200 bg-slate-700 text-white shadow-sm' : 'border-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-700'}`}
          >
            {SUB_ABA_LABEL[sa]}
          </button>
        ))}
      </div>

      {subAba === 'cliente' && (
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3 font-medium">
          Por cliente ({data?.porCliente.length ?? 0}) — clientes abaixo do mínimo abrem para mostrar qual produto pesa mais
        </div>
        <SortableTable
          columns={[
            { key: 'chave', label: 'Cliente', sortValue: (c: VendaAgregada) => c.chave, render: (c) => <span className="font-medium">{c.chave}</span> },
            { key: 'faturamentoLiquido', label: 'Faturamento líquido', align: 'right', sortValue: (c: VendaAgregada) => c.faturamentoLiquido, render: (c) => fmtMoeda(c.faturamentoLiquido) },
            { key: 'vendasUN', label: 'Quantidade (un)', align: 'right', sortValue: (c: VendaAgregada) => c.vendasUN, render: (c) => fmt(c.vendasUN, 0) },
            { key: 'm3Total', label: 'm³ vendido', align: 'right', sortValue: (c: VendaAgregada) => c.m3Total, render: (c) => fmt(c.m3Total, 1) },
            { key: 'valorM3Vendido', label: 'R$/m³ vendido', align: 'right', sortValue: (c: VendaAgregada) => c.valorM3Vendido ?? 0, render: (c) => fmtMoeda(c.valorM3Vendido) },
            { key: 'precoPonderado', label: 'Meta de destino', align: 'right', sortValue: (c: VendaAgregada) => c.precoPonderado ?? 0, render: (c) => fmtMoeda(c.precoPonderado) },
            {
              key: 'situacao',
              label: 'Situação',
              sortValue: (c: VendaAgregada) => (c.abaixoDoMinimo ? 0 : 1),
              render: (c) =>
                c.valorM3Vendido == null ? (
                  <span className="text-slate-400">sem m³</span>
                ) : c.abaixoDoMinimo ? (
                  <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">abaixo do mínimo ({fmtPct(pctMeta(c))})</span>
                ) : (
                  <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">dentro do mínimo ({fmtPct(pctMeta(c))})</span>
                ),
            },
          ]}
          rows={data?.porCliente ?? []}
          rowKey={(c) => c.chave}
          defaultSortKey="faturamentoLiquido"
          emptyMessage="Nenhuma venda no período."
          renderExpanded={(c) => {
            const produtos = (data?.porClienteProduto ?? [])
              .filter((p) => p.cliente === c.chave && p.perdaEstimada > 0)
              .sort((a, b) => b.perdaEstimada - a.perdaEstimada)
              .slice(0, 8)
            if (!c.abaixoDoMinimo) return <p className="pl-2 text-xs text-slate-400">Cliente dentro do mínimo — sem produto a destacar.</p>
            if (produtos.length === 0) return <p className="pl-2 text-xs text-slate-400">Sem detalhe de produto para esta perda.</p>
            return (
              <table className="w-full text-xs">
                <thead className="text-left text-slate-500">
                  <tr>
                    <th className="w-6 py-1 pl-2"></th>
                    <th className="py-1">Produto</th>
                    <th className="py-1 text-right">R$/m³ vendido</th>
                    <th className="py-1 text-right">Meta de destino</th>
                    <th className="py-1 text-right">Perda estimada</th>
                  </tr>
                </thead>
                <tbody>
                  {produtos.map((p) => {
                    const chaveProduto = `${c.chave}|${p.produto}`
                    const aberto = clienteProdutosExpandidos.has(chaveProduto)
                    const notas = (data?.porClienteProdutoNota ?? [])
                      .filter((n) => n.cliente === c.chave && n.produto === p.produto)
                      .sort((a, b) => a.data.localeCompare(b.data))
                    return (
                      <Fragment key={p.produto}>
                        <tr
                          className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                          onClick={() =>
                            setClienteProdutosExpandidos((prev) => {
                              const next = new Set(prev)
                              if (next.has(chaveProduto)) next.delete(chaveProduto)
                              else next.add(chaveProduto)
                              return next
                            })
                          }
                        >
                          <td className="py-1 pl-2 text-slate-400">{aberto ? '▾' : '▸'}</td>
                          <td className="py-1">{p.produto}</td>
                          <td className="py-1 text-right">{fmtMoeda(p.valorM3Vendido)}</td>
                          <td className="py-1 text-right">{fmtMoeda(p.precoPonderado)}</td>
                          <td className="py-1 text-right text-red-700">{fmtMoeda(p.perdaEstimada)}</td>
                        </tr>
                        {aberto && (
                          <tr className="border-t border-slate-100 bg-slate-50">
                            <td colSpan={5} className="px-2 py-2">
                              {notas.length === 0 ? (
                                <span className="text-slate-400">Sem NF encontrada para este produto/cliente.</span>
                              ) : (
                                <table className="w-full">
                                  <thead className="text-left text-slate-500">
                                    <tr>
                                      <th className="py-1 pl-2">NF</th>
                                      <th className="py-1">Data</th>
                                      <th className="py-1 text-right">m³</th>
                                      <th className="py-1 text-right">R$/m³ vendido</th>
                                      <th className="py-1 text-right">Meta de destino</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {notas.map((n) => (
                                      <tr key={n.numeroMov} className="border-t border-slate-100">
                                        <td className="py-1 pl-2 font-medium">{n.numeroMov || '—'}</td>
                                        <td className="py-1">{n.data ? fmtDateBR(n.data) : '—'}</td>
                                        <td className="py-1 text-right">{fmt(n.m3Total, 2)}</td>
                                        <td className="py-1 text-right">{fmtMoeda(n.valorM3Vendido)}</td>
                                        <td className="py-1 text-right">{fmtMoeda(n.precoPonderado)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            )
          }}
        />
      </div>
      )}

      {subAba === 'produto' && (
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3 font-medium">
          Por produto específico ({data?.porProdutoEspecifico.length ?? 0})
        </div>
        <SortableTable
          columns={[
            { key: 'produto', label: 'Produto', sortValue: (p: VendaPorProdutoEspecifico) => p.produto, render: (p) => <span className="font-medium">{p.produto}</span> },
            { key: 'tabelaPreco', label: 'Tabela', sortValue: (p: VendaPorProdutoEspecifico) => p.tabelaPreco, render: (p) => <span className="text-xs text-slate-600">{p.tabelaPreco}</span> },
            { key: 'faturamentoLiquido', label: 'Faturamento líquido', align: 'right', sortValue: (p: VendaPorProdutoEspecifico) => p.faturamentoLiquido, render: (p) => fmtMoeda(p.faturamentoLiquido) },
            { key: 'vendasUN', label: 'Quantidade (un)', align: 'right', sortValue: (p: VendaPorProdutoEspecifico) => p.vendasUN, render: (p) => fmt(p.vendasUN, 0) },
            { key: 'm3Total', label: 'm³ vendido', align: 'right', sortValue: (p: VendaPorProdutoEspecifico) => p.m3Total, render: (p) => fmt(p.m3Total, 1) },
            { key: 'valorM3Vendido', label: 'R$/m³ vendido', align: 'right', sortValue: (p: VendaPorProdutoEspecifico) => p.valorM3Vendido ?? 0, render: (p) => fmtMoeda(p.valorM3Vendido) },
            { key: 'precoPonderado', label: 'Meta de destino', align: 'right', sortValue: (p: VendaPorProdutoEspecifico) => p.precoPonderado ?? 0, render: (p) => fmtMoeda(p.precoPonderado) },
            {
              key: 'situacao',
              label: 'Situação',
              sortValue: (p: VendaPorProdutoEspecifico) => (p.abaixoDoMinimo ? 0 : 1),
              render: (p) =>
                p.valorM3Vendido == null ? (
                  <span className="text-slate-400">sem m³</span>
                ) : p.abaixoDoMinimo ? (
                  <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">abaixo do mínimo ({fmtPct(pctMeta(p))})</span>
                ) : (
                  <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">dentro do mínimo ({fmtPct(pctMeta(p))})</span>
                ),
            },
          ]}
          rows={data?.porProdutoEspecifico ?? []}
          rowKey={(p) => p.chave}
          defaultSortKey="faturamentoLiquido"
          emptyMessage="Nenhuma venda no período."
        />
      </div>
      )}

      {subAba === 'tempo' && (
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3 font-medium">
          Produtos ao longo do tempo — meses com perda de preço x meses OK
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              <th className="w-8 px-3 py-2" />
              <th className="px-3 py-2">Produto</th>
              <th className="px-3 py-2 text-right">Faturamento líquido</th>
              <th className="px-3 py-2 text-center">Meses com perda</th>
              <th className="px-3 py-2 text-center">Meses OK</th>
              <th className="px-3 py-2">Linha do tempo</th>
            </tr>
          </thead>
          <tbody>
            {(data?.produtosPorMes ?? []).map((p) => {
              const aberto = produtosExpandidos.has(p.produto)
              return (
                <Fragment key={p.produto}>
                  <tr
                    className="cursor-pointer border-t border-slate-100 align-top hover:bg-slate-50"
                    onClick={() =>
                      setProdutosExpandidos((prev) => {
                        const next = new Set(prev)
                        if (next.has(p.produto)) next.delete(p.produto)
                        else next.add(p.produto)
                        return next
                      })
                    }
                  >
                    <td className="px-3 py-2 text-slate-400">{aberto ? '▾' : '▸'}</td>
                    <td className="px-3 py-2 font-medium">{p.produto}</td>
                    <td className="px-3 py-2 text-right">{fmtMoeda(p.faturamentoLiquido)}</td>
                    <td className="px-3 py-2 text-center">
                      {p.mesesComPerda > 0 ? (
                        <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                          {p.mesesComPerda}
                        </span>
                      ) : (
                        <span className="text-slate-400">0</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {p.mesesOk > 0 ? (
                        <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                          {p.mesesOk}
                        </span>
                      ) : (
                        <span className="text-slate-400">0</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {p.meses.map((m) => (
                          <span
                            key={m.mes}
                            title={`${fmtMes(m.mes)} — R$/m³ ${fmtMoeda(m.valorM3Vendido)} vs mínimo ${fmtMoeda(m.precoPonderado)}`}
                            className={
                              'rounded px-1.5 py-0.5 text-xs font-medium ' +
                              (m.valorM3Vendido == null
                                ? 'bg-slate-100 text-slate-400'
                                : m.abaixoDoMinimo
                                  ? 'bg-red-100 text-red-700'
                                  : 'bg-emerald-100 text-emerald-800')
                            }
                          >
                            {fmtMes(m.mes)}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                  {aberto && (
                    <tr className="border-t border-slate-100 bg-slate-50">
                      <td colSpan={6} className="px-4 py-3">
                        {renderProdutoDistribuidorCliente(p.produto, data?.porDistribuidorClienteProduto ?? [])}
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
            {(data?.produtosPorMes.length ?? 0) === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  Nenhuma venda no período.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      )}

      {subAba === 'dispersao' && (
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3 font-medium">
          Dispersão de preço por produto × ICMS (top 30) — mesmo produto, mesma alíquota, preços muito
          diferentes entre vendas
        </div>
        <SortableTable
          columns={[
            { key: 'produto', label: 'Produto', sortValue: (d: DispersaoPreco) => d.produto, render: (d) => <span className="font-medium">{d.produto}</span> },
            { key: 'tabelaPreco', label: 'ICMS', sortValue: (d: DispersaoPreco) => d.tabelaPreco, render: (d) => d.tabelaPreco },
            { key: 'n', label: 'Nº vendas', align: 'right', sortValue: (d: DispersaoPreco) => d.n, render: (d) => fmt(d.n) },
            { key: 'precoMin', label: 'Preço mín.', align: 'right', sortValue: (d: DispersaoPreco) => d.precoMin, render: (d) => fmtMoeda(d.precoMin) },
            { key: 'precoMedio', label: 'Preço médio', align: 'right', sortValue: (d: DispersaoPreco) => d.precoMedio, render: (d) => fmtMoeda(d.precoMedio) },
            { key: 'precoMax', label: 'Preço máx.', align: 'right', sortValue: (d: DispersaoPreco) => d.precoMax, render: (d) => fmtMoeda(d.precoMax) },
            {
              key: 'variacaoPct',
              label: 'Variação',
              align: 'right',
              sortValue: (d: DispersaoPreco) => d.variacaoPct,
              render: (d) => (
                <span className={d.variacaoPct > 0.3 ? 'font-medium text-amber-700' : ''}>
                  {(d.variacaoPct * 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%
                </span>
              ),
            },
          ]}
          rows={data?.dispersaoPreco ?? []}
          rowKey={(d) => `${d.produto}|${d.tabelaPreco}`}
          defaultSortKey="variacaoPct"
          emptyMessage="Sem produtos com vendas suficientes no período para medir variação."
          renderExpanded={(d) => (
            <table className="w-full text-xs">
              <thead className="text-left text-slate-500">
                <tr>
                  <th className="py-1 pl-2"></th>
                  <th className="py-1">Cliente</th>
                  <th className="py-1">Distribuidor</th>
                  <th className="py-1">Data</th>
                  <th className="py-1 text-right">Preço</th>
                  <th className="py-1 text-right"></th>
                </tr>
              </thead>
              <tbody>
                {[
                  { rotulo: 'Menor preço', t: d.notaMin },
                  { rotulo: 'Maior preço', t: d.notaMax },
                ].map(({ rotulo, t }) => (
                  <tr key={rotulo} className="border-t border-slate-100">
                    <td className="py-1 pl-2 font-medium text-slate-500">{rotulo}</td>
                    {t ? (
                      <>
                        <td className="py-1">{t.cliente}</td>
                        <td className="py-1">{t.distribuidor}</td>
                        <td className="py-1">{fmtDateBR(t.data)}</td>
                        <td className="py-1 text-right">{fmtMoeda(t.preco)}</td>
                        <td className="py-1 text-right">
                          <button
                            type="button"
                            onClick={() => abrirNotaFiscal(t)}
                            className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 hover:bg-emerald-200"
                            title={`Abrir NF ${t.numeroMov || '—'} na aba Por Nota Fiscal`}
                          >
                            NF {t.numeroMov || '—'} ↗
                          </button>
                        </td>
                      </>
                    ) : (
                      <td className="py-1 text-slate-400" colSpan={5}>sem transação encontrada</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        />
      </div>
      )}

      {subAba === 'abaixoTabela' && (
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3 font-medium">
          Vendas abaixo do preço de tabela do distribuidor (top 50 por valor perdido)
          {data?.abaixoTabela4Total && (
            <span className="ml-2 text-xs font-normal text-slate-500">
              — {fmt(data.abaixoTabela4Total.transacoes)} transações no período, {fmtMoeda(data.abaixoTabela4Total.valorPerdido)} de diferença total
            </span>
          )}
        </div>
        <p className="px-4 pb-2 text-xs text-slate-500">
          Pedido original da nota Fase 3 ("demonstrar quando o preço vendido for menor que o preço de
          tabela do distribuidor") — diferente do indicador "abaixo do mínimo" (que compara a média
          ponderada de um grupo contra o ICMS): aqui é por transação individual.
        </p>
        <SortableTable
          columns={[
            { key: 'data', label: 'Data', sortValue: (l: VendaAbaixoTabela4) => l.data, render: (l) => fmtDateBR(l.data) },
            { key: 'distribuidor', label: 'Distribuidor', sortValue: (l: VendaAbaixoTabela4) => l.distribuidor, render: (l) => l.distribuidor },
            { key: 'cliente', label: 'Cliente', sortValue: (l: VendaAbaixoTabela4) => l.cliente, render: (l) => l.cliente },
            { key: 'produto', label: 'Produto', sortValue: (l: VendaAbaixoTabela4) => l.produto, render: (l) => <span className="text-xs">{l.produto}</span> },
            { key: 'precoVendido', label: 'Preço vendido', align: 'right', sortValue: (l: VendaAbaixoTabela4) => l.precoVendido, render: (l) => fmtMoeda(l.precoVendido) },
            { key: 'precoMedioTabela4', label: 'Tabela preço base', align: 'right', sortValue: (l: VendaAbaixoTabela4) => l.precoMedioTabela4, render: (l) => fmtMoeda(l.precoMedioTabela4) },
            {
              key: 'valorPerdido',
              label: 'Valor perdido',
              align: 'right',
              sortValue: (l: VendaAbaixoTabela4) => l.valorPerdido,
              render: (l) => <span className="font-medium text-red-700">{fmtMoeda(l.valorPerdido)}</span>,
            },
          ]}
          rows={data?.abaixoTabela4 ?? []}
          rowKey={(l, i) => `${l.data}-${l.distribuidor}-${l.produto}-${i}`}
          defaultSortKey="valorPerdido"
          emptyMessage="Nenhuma venda abaixo do preço de tabela do distribuidor no período."
        />
      </div>
      )}
        </>
      )}
    </div>
  )
}
