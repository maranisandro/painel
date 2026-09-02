'use client'

import { useEffect, useMemo, useState } from 'react'
import { DateRangeInputs, fmtDateBR } from '@/components/shared/DateRangeInputs'
import { SortableTable, type SortableColumn } from '@/components/shared/SortableTable'
import { UltimaAtualizacao } from '@/components/shared/ui/UltimaAtualizacao'
import { hojeBrasil } from '@/lib/horario-brasil'
import { SelectableBarChart, TurnoverChart } from './Charts'
import {
  type FuncionarioRow,
  type TurnoverMes,
  contarPor,
  media,
  membrosCipaComEstabilidade,
  normalizarFuncao,
  porEmpresa,
  porEmpresaSst,
  porEstabelecimentoAprendiz,
  resumoQuadro,
} from '@/lib/rh/funcionarios'

function monthStart(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

interface ApiData {
  period: { from: string; to: string }
  ultimaAtualizacao: string | null
  quadroAtual: FuncionarioRow[]
  desligamentos: FuncionarioRow[]
  transferencias: FuncionarioRow[]
  turnoverMensal: TurnoverMes[]
  semDados: boolean
}

type Dimensao = 'categoria' | 'funcao' | 'setor' | 'empresa'
type Aba = 'quadro' | 'desligamentos' | 'pcd' | 'aprendiz' | 'sst'

const ABA_LABEL: Record<Aba, string> = {
  quadro: 'Quadro Atual',
  desligamentos: 'Desligamentos',
  pcd: 'PCD',
  aprendiz: 'Aprendiz',
  sst: 'SST',
}

function fmtAnos(v: number | null): string {
  return v === null ? '—' : `${v.toFixed(1)} anos`
}

function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-emerald-700">{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </div>
  )
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-xs text-emerald-800">
      {label}
      <button onClick={onRemove} className="ml-1 text-emerald-600 hover:text-emerald-900" title="Remover filtro">
        ×
      </button>
    </span>
  )
}

function StatusBadge({ ok, label }: { ok: boolean | null; label: string }) {
  if (ok === null) return <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{label}</span>
  return (
    <span className={`rounded px-2 py-0.5 text-xs ${ok ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
      {label}
    </span>
  )
}

/** Botão de nome clicável para cross-filtragem (empresa) — clique simples troca, Ctrl/Cmd+clique adiciona/remove. */
function NomeClicavel({ label, selecionado, onClick }: { label: string; selecionado: boolean; onClick: (ctrl: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={(e) => onClick(e.ctrlKey || e.metaKey)}
      title="Clique para filtrar os gráficos por esta empresa (Ctrl/Cmd+clique para adicionar mais de uma)"
      className={`rounded px-1.5 py-0.5 text-left hover:bg-emerald-50 ${selecionado ? 'bg-emerald-100 font-medium text-emerald-800' : ''}`}
    >
      {label}
    </button>
  )
}

/** Toggle de seleção: clique simples troca (ou limpa se já era o único selecionado), Ctrl/Cmd+clique adiciona/remove. */
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

export function RhDashboard() {
  const [aba, setAba] = useState<Aba>('quadro')
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(hojeBrasil())
  const [data, setData] = useState<ApiData | null>(null)
  const [loading, setLoading] = useState(true)

  const [categorias, setCategorias] = useState<Set<string>>(new Set())
  const [funcoes, setFuncoes] = useState<Set<string>>(new Set())
  const [setores, setSetores] = useState<Set<string>>(new Set())
  const [empresas, setEmpresas] = useState<Set<string>>(new Set())

  useEffect(() => {
    setLoading(true)
    fetch(`/api/rh/data?from=${from}&to=${to}`)
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false))
  }, [from, to])

  const quadro = data?.quadroAtual ?? []

  // applyExcept: cada gráfico reflete os filtros das OUTRAS dimensões, nunca
  // o próprio (senão clicar numa barra faz ela sumir do próprio gráfico) —
  // mesmo padrão de cross-filtragem usado em fase1/fase3.
  // Mesclagem de variações de função (ex.: "AJUDANTE FLORESTAL I"/"II" viram
  // "AJUDANTE FLORESTAL") — pedido do usuário 2026-08-13. O filtro por função
  // compara pelo nome já mesclado, senão selecionar "AJUDANTE FLORESTAL" não
  // pegaria as duas variantes de origem.
  function aplicarFiltros(rows: FuncionarioRow[], excluir: Dimensao | null): FuncionarioRow[] {
    let out = rows
    if (excluir !== 'categoria' && categorias.size) out = out.filter((r) => categorias.has(r.CATEGORIA_RH))
    if (excluir !== 'funcao' && funcoes.size) out = out.filter((r) => funcoes.has(normalizarFuncao(r.FUNCAO)))
    if (excluir !== 'setor' && setores.size) out = out.filter((r) => setores.has(r.SECAO))
    if (excluir !== 'empresa' && empresas.size) out = out.filter((r) => empresas.has(r.COLIGADA))
    return out
  }

  const rowsFiltradas = useMemo(() => aplicarFiltros(quadro, null), [quadro, categorias, funcoes, setores, empresas])
  const porCategoriaData = useMemo(() => contarPor(aplicarFiltros(quadro, 'categoria'), (r) => r.CATEGORIA_RH), [quadro, categorias, funcoes, setores, empresas])
  const porFuncaoData = useMemo(() => contarPor(aplicarFiltros(quadro, 'funcao'), (r) => normalizarFuncao(r.FUNCAO)).slice(0, 15), [quadro, categorias, funcoes, setores, empresas])
  const porSetorData = useMemo(() => contarPor(aplicarFiltros(quadro, 'setor'), (r) => r.SECAO).slice(0, 15), [quadro, categorias, funcoes, setores, empresas])

  const resumo = useMemo(() => resumoQuadro(rowsFiltradas), [rowsFiltradas])

  // Empresa (PCD), estabelecimento (aprendiz) e SST SEMPRE sobre o quadro
  // atual INTEIRO, nunca cross-filtrado — as cotas legais (Lei 8.213/91 art.
  // 93, CLT art. 429) usam o total real de empregados da empresa/
  // estabelecimento; misturar com um recorte de função/setor daria um
  // "mínimo legal" errado. O clique no nome da empresa (aba Quadro Atual)
  // ainda funciona como filtro para os OUTROS gráficos, só não afeta estas
  // três tabelas.
  const empresasResumo = useMemo(() => porEmpresa(quadro), [quadro])
  const aprendizPorEstabelecimento = useMemo(() => porEstabelecimentoAprendiz(quadro), [quadro])
  const sstPorEmpresa = useMemo(() => porEmpresaSst(quadro), [quadro])
  const membrosCipa = useMemo(() => membrosCipaComEstabilidade(quadro, hojeBrasil()), [quadro])

  const pcdAbaixoDoMinimo = useMemo(() => empresasResumo.some((e) => e.pcdPercentualLegal > 0 && e.pcdAtual < e.pcdMinimoLegal), [empresasResumo])
  const aprendizAbaixoDoMinimo = useMemo(() => aprendizPorEstabelecimento.some((e) => e.aprendizesAtual < e.minimoLegal), [aprendizPorEstabelecimento])

  const desligamentos = data?.desligamentos ?? []
  const transferencias = data?.transferencias ?? []
  const turnover = data?.turnoverMensal ?? []
  const desligamentosPorTipo = useMemo(() => contarPor(desligamentos, (r) => r.TIPODEMISSAO ?? 'Não informado'), [desligamentos])
  const tempoMedioDesligados = useMemo(() => media(desligamentos.map((r) => r.TEMPO_EMPRESA_ANOS)), [desligamentos])

  const empresaColumns: SortableColumn<(typeof empresasResumo)[number]>[] = [
    {
      key: 'coligada',
      label: 'Empresa',
      sortValue: (r) => r.coligada,
      render: (r) => (
        <NomeClicavel
          label={r.coligada}
          selecionado={empresas.has(r.coligada)}
          onClick={(ctrl) => toggleSelecao(empresas, setEmpresas, r.coligada, ctrl)}
        />
      ),
    },
    { key: 'quantidade', label: 'Colaboradores', align: 'right', sortValue: (r) => r.quantidade, render: (r) => r.quantidade.toLocaleString('pt-BR') },
    {
      key: 'tempo',
      label: 'Tempo médio de empresa',
      align: 'right',
      sortValue: (r) => r.tempoEmpresaMedioAnos ?? -1,
      render: (r) => fmtAnos(r.tempoEmpresaMedioAnos),
    },
  ]

  const pcdColumns: SortableColumn<(typeof empresasResumo)[number]>[] = [
    { key: 'coligada', label: 'Empresa', sortValue: (r) => r.coligada, render: (r) => r.coligada },
    { key: 'quantidade', label: 'Colaboradores', align: 'right', sortValue: (r) => r.quantidade, render: (r) => r.quantidade.toLocaleString('pt-BR') },
    { key: 'pcdAtual', label: 'PCD atual', align: 'right', sortValue: (r) => r.pcdAtual, render: (r) => r.pcdAtual.toLocaleString('pt-BR') },
    {
      key: 'pcdMinimo',
      label: 'PCD mínimo legal',
      align: 'right',
      sortValue: (r) => r.pcdMinimoLegal,
      render: (r) => (r.pcdPercentualLegal > 0 ? `${r.pcdMinimoLegal.toLocaleString('pt-BR')} (${(r.pcdPercentualLegal * 100).toFixed(0)}%)` : '—'),
    },
    {
      key: 'pcdStatus',
      label: 'Situação',
      align: 'center',
      sortValue: (r) => (r.pcdPercentualLegal === 0 ? 2 : r.pcdAtual >= r.pcdMinimoLegal ? 1 : 0),
      render: (r) =>
        r.pcdPercentualLegal === 0 ? (
          <StatusBadge ok={null} label="Isento (< 100 colab.)" />
        ) : (
          <StatusBadge ok={r.pcdAtual >= r.pcdMinimoLegal} label={r.pcdAtual >= r.pcdMinimoLegal ? 'Dentro da cota' : 'Abaixo do mínimo'} />
        ),
    },
  ]

  const aprendizColumns: SortableColumn<(typeof aprendizPorEstabelecimento)[number]>[] = [
    { key: 'coligada', label: 'Empresa', sortValue: (r) => r.coligada, render: (r) => r.coligada },
    { key: 'filial', label: 'Estabelecimento', sortValue: (r) => r.filial, render: (r) => r.filial },
    { key: 'base', label: 'Base de cálculo', align: 'right', sortValue: (r) => r.baseCalculo, render: (r) => r.baseCalculo.toLocaleString('pt-BR') },
    { key: 'atual', label: 'Aprendizes atuais', align: 'right', sortValue: (r) => r.aprendizesAtual, render: (r) => r.aprendizesAtual.toLocaleString('pt-BR') },
    {
      key: 'faixa',
      label: 'Faixa legal (5% – 15%)',
      align: 'right',
      sortValue: (r) => r.minimoLegal,
      render: (r) => `${r.minimoLegal.toLocaleString('pt-BR')} – ${r.maximoLegal.toLocaleString('pt-BR')}`,
    },
    {
      key: 'status',
      label: 'Situação',
      align: 'center',
      sortValue: (r) => (r.aprendizesAtual < r.minimoLegal ? 0 : r.aprendizesAtual > r.maximoLegal ? 1 : 2),
      render: (r) =>
        r.aprendizesAtual < r.minimoLegal ? (
          <StatusBadge ok={false} label="Abaixo do mínimo" />
        ) : r.aprendizesAtual > r.maximoLegal ? (
          <StatusBadge ok={false} label="Acima do máximo" />
        ) : (
          <StatusBadge ok={true} label="Dentro da faixa" />
        ),
    },
  ]

  const sstColumns: SortableColumn<(typeof sstPorEmpresa)[number]>[] = [
    { key: 'coligada', label: 'Empresa', sortValue: (r) => r.coligada, render: (r) => r.coligada },
    { key: 'colaboradores', label: 'Colaboradores', align: 'right', sortValue: (r) => r.colaboradores, render: (r) => r.colaboradores.toLocaleString('pt-BR') },
    { key: 'cipa', label: 'Membros CIPA', align: 'right', sortValue: (r) => r.membrosCipa, render: (r) => r.membrosCipa.toLocaleString('pt-BR') },
    {
      key: 'sst',
      label: 'Funções de SST',
      sortValue: (r) => r.funcoesSst.reduce((s, f) => s + f.value, 0),
      render: (r) =>
        r.funcoesSst.length === 0 ? (
          <span className="text-slate-400">—</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {r.funcoesSst.map((f) => (
              <span key={f.name} className="rounded bg-slate-100 px-2 py-0.5 text-xs">
                {f.name}: {f.value}
              </span>
            ))}
          </div>
        ),
    },
  ]

  const membrosCipaColumns: SortableColumn<(typeof membrosCipa)[number]>[] = [
    { key: 'nome', label: 'Nome', sortValue: (r) => r.nome, render: (r) => r.nome },
    { key: 'coligada', label: 'Empresa', sortValue: (r) => r.coligada, render: (r) => r.coligada },
    { key: 'funcao', label: 'Função', sortValue: (r) => r.funcao, render: (r) => r.funcao },
    {
      key: 'estabilidade',
      label: 'Data de estabilidade',
      align: 'right',
      sortValue: (r) => r.dataEstabilidade ?? '',
      render: (r) => (r.dataEstabilidade ? fmtDateBR(r.dataEstabilidade) : '—'),
    },
    {
      key: 'status',
      label: 'Situação',
      align: 'center',
      sortValue: (r) => (r.dentroDaEstabilidade === null ? 2 : r.dentroDaEstabilidade ? 1 : 0),
      render: (r) =>
        r.dentroDaEstabilidade === null ? (
          <StatusBadge ok={null} label="Sem data registrada" />
        ) : (
          <StatusBadge ok={r.dentroDaEstabilidade} label={r.dentroDaEstabilidade ? 'Dentro da estabilidade' : 'Fora da estabilidade'} />
        ),
    },
  ]

  const filtrosAtivos = [
    ...[...categorias].map((v) => ({ dim: 'categoria' as const, v })),
    ...[...funcoes].map((v) => ({ dim: 'funcao' as const, v })),
    ...[...setores].map((v) => ({ dim: 'setor' as const, v })),
    ...[...empresas].map((v) => ({ dim: 'empresa' as const, v })),
  ]

  function removerFiltro(dim: Dimensao, v: string) {
    const set = dim === 'categoria' ? categorias : dim === 'funcao' ? funcoes : dim === 'setor' ? setores : empresas
    const setSet = dim === 'categoria' ? setCategorias : dim === 'funcao' ? setFuncoes : dim === 'setor' ? setSetores : setEmpresas
    const next = new Set(set)
    next.delete(v)
    setSet(next)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Recursos Humanos</h1>
        <UltimaAtualizacao iso={data?.ultimaAtualizacao} />
        <p className="mt-1 text-sm text-slate-500">
          Quadro atual (Ativo/Férias/Outros — sempre a situação de hoje) e desligamentos no período selecionado.
          Transferências internas (sem ônus para o cedente) não entram como desligamento.
        </p>
      </div>

      {loading && <span className="text-xs text-slate-500">carregando…</span>}
      {data?.semDados && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Nenhum dado sincronizado ainda para o dataset rh_funcionarios. Peça a um administrador para rodar a sincronização em Fontes de Dados.
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-b border-slate-200">
        {(['quadro', 'desligamentos', 'pcd', 'aprendiz', 'sst'] as Aba[]).map((a) => (
          <button
            key={a}
            onClick={() => setAba(a)}
            className={`-mb-px flex items-center gap-1.5 rounded-t-md border border-b-0 px-4 py-2 text-sm font-medium transition-colors ${
              aba === a ? 'border-slate-200 bg-emerald-700 text-white shadow-sm' : 'border-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-700'
            }`}
          >
            {ABA_LABEL[a]}
            {a === 'pcd' && pcdAbaixoDoMinimo && (
              <span title="Alguma empresa está abaixo do mínimo legal de PCD">⚠️</span>
            )}
            {a === 'aprendiz' && aprendizAbaixoDoMinimo && (
              <span title="Algum estabelecimento está abaixo do mínimo legal de aprendizes">⚠️</span>
            )}
          </button>
        ))}
      </div>

      {(aba === 'quadro') && filtrosAtivos.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500">Filtros:</span>
          {filtrosAtivos.map(({ dim, v }) => (
            <Chip key={`${dim}-${v}`} label={v} onRemove={() => removerFiltro(dim, v)} />
          ))}
        </div>
      )}

      {aba === 'quadro' && (
        <section>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <KpiCard label="Total" value={resumo.total.toLocaleString('pt-BR')} />
            <KpiCard label="Homens" value={resumo.porSexo.M.toLocaleString('pt-BR')} />
            <KpiCard label="Mulheres" value={resumo.porSexo.F.toLocaleString('pt-BR')} />
            <KpiCard label="Idade média — Homens" value={resumo.idadeMediaPorSexo.M !== null ? `${resumo.idadeMediaPorSexo.M.toFixed(1)} anos` : '—'} />
            <KpiCard label="Idade média — Mulheres" value={resumo.idadeMediaPorSexo.F !== null ? `${resumo.idadeMediaPorSexo.F.toFixed(1)} anos` : '—'} />
            <KpiCard label="Tempo médio de empresa" value={fmtAnos(resumo.tempoEmpresaMedioAnos)} />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <SelectableBarChart
              title="Por situação"
              data={porCategoriaData}
              selected={categorias}
              onSelect={(v, ctrl) => toggleSelecao(categorias, setCategorias, v, ctrl)}
            />
            <SelectableBarChart
              title="Por função (top 15)"
              data={porFuncaoData}
              selected={funcoes}
              onSelect={(v, ctrl) => toggleSelecao(funcoes, setFuncoes, v, ctrl)}
            />
            <SelectableBarChart
              title="Por setor (top 15)"
              data={porSetorData}
              selected={setores}
              onSelect={(v, ctrl) => toggleSelecao(setores, setSetores, v, ctrl)}
            />
          </div>

          <div className="mt-4 rounded-xl border border-slate-200 bg-white">
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4">
              <h2 className="font-medium">Por empresa</h2>
              <p className="text-xs text-slate-500">Clique no nome para filtrar os gráficos acima (Ctrl/Cmd+clique para mais de uma).</p>
            </div>
            <div className="overflow-x-auto">
              <SortableTable columns={empresaColumns} rows={empresasResumo} rowKey={(r) => r.coligada} defaultSortKey="quantidade" />
            </div>
          </div>
        </section>
      )}

      {aba === 'desligamentos' && (
        <section>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Desligamentos no período</h2>
            <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3">
              <DateRangeInputs from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
              {data?.period && (
                <span className="text-xs text-slate-500">
                  Período: {fmtDateBR(data.period.from)} a {fmtDateBR(data.period.to)}
                </span>
              )}
            </div>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <KpiCard label="Desligamentos" value={desligamentos.length.toLocaleString('pt-BR')} />
            <KpiCard label="Tempo médio de empresa (desligados)" value={fmtAnos(tempoMedioDesligados)} />
            <KpiCard
              label="Transferências internas"
              value={transferencias.length.toLocaleString('pt-BR')}
              sub="Sem ônus para o cedente — não contam como desligamento"
            />
          </div>

          <div className="mt-4">
            <SelectableBarChart title="Por motivo de desligamento" data={desligamentosPorTipo} selected={new Set()} onSelect={() => {}} height={Math.max(200, desligamentosPorTipo.length * 32)} />
          </div>

          <div className="mt-4">
            <TurnoverChart data={turnover} title="Turnover mensal (últimos 12 meses)" />
            <p className="mt-2 text-xs text-slate-500">
              Turnover = ((admissões + desligamentos) / 2) ÷ efetivo médio do mês × 100. Admissões nesta base não
              distinguem contratação externa de transferência recebida de outra empresa do grupo — o número pode
              incluir transferências de entrada.
            </p>
          </div>
        </section>
      )}

      {aba === 'pcd' && (
        <section>
          <p className="text-sm text-slate-500">
            Cota legal de PCD conforme Lei 8.213/91, art. 93 — faixas por total de colaboradores da empresa (isento
            abaixo de 100). Calculado sobre o quadro atual inteiro, sem cross-filtragem.
          </p>
          <div className="mt-3 rounded-xl border border-slate-200 bg-white">
            <div className="overflow-x-auto">
              <SortableTable columns={pcdColumns} rows={empresasResumo} rowKey={(r) => r.coligada} defaultSortKey="quantidade" />
            </div>
          </div>
        </section>
      )}

      {aba === 'aprendiz' && (
        <section>
          <p className="text-sm text-slate-500">
            Estimativa conforme CLT art. 429 (5%–15% dos trabalhadores por estabelecimento). Base exclui Diretor,
            Estagiário e o próprio Aprendiz — cargos técnicos/superiores dentro de &quot;Normal&quot; não são
            excluídos por falta de classificação por CBO nesta base. Não substitui análise jurídica cargo a cargo.
          </p>
          <div className="mt-3 rounded-xl border border-slate-200 bg-white">
            <div className="overflow-x-auto">
              <SortableTable columns={aprendizColumns} rows={aprendizPorEstabelecimento} rowKey={(r) => `${r.coligada}-${r.codFilial}`} defaultSortKey="base" />
            </div>
          </div>
        </section>
      )}

      {aba === 'sst' && (
        <section>
          <p className="text-sm text-slate-500">
            Quadro ATUAL de SST por empresa (membros de CIPA + funções de segurança/medicina/enfermagem do trabalho —
            &quot;Monitor de Segurança&quot; não entra, é vigilância patrimonial, não SST). Esta base não tem CNAE nem
            grau de risco por empresa, então não é possível calcular o dimensionamento MÍNIMO legal de SESMT (NR-4)
            nem de CIPA (NR-5) — só o que já existe hoje. Achado: o campo MEMBROCIPA diverge do texto
            TIPOAFASTAMENTO=&quot;Membro Cipa&quot; na origem (15 vs. 65 no quadro atual) — usado aqui o campo
            MEMBROCIPA, mais específico; a divergência não foi corrigida por não haver como saber qual está certo a
            partir desta base.
          </p>
          <div className="mt-3 rounded-xl border border-slate-200 bg-white">
            <div className="overflow-x-auto">
              <SortableTable columns={sstColumns} rows={sstPorEmpresa} rowKey={(r) => r.coligada} defaultSortKey="colaboradores" />
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-slate-200 bg-white">
            <div className="px-4 pt-4">
              <h2 className="font-medium">Membros da CIPA — estabilidade</h2>
              <p className="text-xs text-slate-500">
                CLT art. 165 / CF art. 10 ADCT: membro eleito da CIPA tem estabilidade da candidatura até 1 ano após o
                fim do mandato. DATAESTABILIDADE já vem calculada pela origem (TOTVS RM); aqui só se compara com hoje.
              </p>
            </div>
            <div className="mt-2 overflow-x-auto">
              <SortableTable columns={membrosCipaColumns} rows={membrosCipa} rowKey={(r) => r.chapa} defaultSortKey="coligada" defaultSortDir="asc" />
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
