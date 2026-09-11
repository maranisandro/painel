'use client'

import { useCallback, useEffect, useState } from 'react'
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { DateRangeInputs, fmtDateBR } from '@/components/shared/DateRangeInputs'
import { SortableTable, type SortableColumn } from '@/components/shared/SortableTable'

interface RankingAcesso {
  userId: string
  nome: string
  logins: number
}
interface RankingUso {
  userId: string
  nome: string
  minutosAtivos: number
}
interface ModuloUso {
  module: string
  visualizacoes: number
}
interface UsuarioInativo {
  userId: string
  nome: string
  email: string
  ultimoLogin: string | null
}
interface EstatisticasUsoData {
  period: { from: string; to: string }
  rankingAcessos: RankingAcesso[]
  rankingUsoReal: RankingUso[]
  moduloMaisUsado: ModuloUso[]
  horarios: number[]
  quemNaoUsa: UsuarioInativo[]
}

/** Códigos derivados do 2º segmento do path (ver moduleFromPath em /api/telemetry/event) -> nome amigável pro gráfico/tabela. */
const NOME_MODULO: Record<string, string> = {
  home: 'Início',
  fase1: 'Fase 1 — Transporte',
  fase3: 'Fase 3 — Madeira tratada',
  fase5: 'Fase 5',
  rh: 'RH',
  abastecimento: 'Abastecimento',
  admin: 'Cadastros',
  datasets: 'Datasets',
}
function nomeModulo(codigo: string): string {
  return NOME_MODULO[codigo] ?? codigo
}

function primeiroDiaDoMes(): string {
  const hoje = new Date()
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-01`
}
function hojeStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function fmtMinutos(min: number): string {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`
}

function StatTile({ label, valor, sub }: { label: string; valor: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-emerald-700">{valor}</p>
      {sub && <p className="mt-1 text-xs text-slate-400">{sub}</p>}
    </div>
  )
}

function BarChartCard({ titulo, dados }: { titulo: string; dados: { name: string; value: number }[] }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="font-medium">{titulo}</h2>
      {dados.length === 0 ? (
        <p className="mt-8 text-center text-sm text-slate-400">Sem dado no período.</p>
      ) : (
        <div className="mt-2 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={dados} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={dados.length > 8 ? -30 : 0} textAnchor={dados.length > 8 ? 'end' : 'middle'} height={dados.length > 8 ? 40 : 24} />
              <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
              <Tooltip formatter={(v) => Number(v).toLocaleString('pt-BR')} />
              <Bar dataKey="value" fill="#047857" radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

/**
 * Estatísticas de Uso — pedido do usuário 2026-08-29: "criar um módulo de
 * estatísticas de uso do sistema de painéis, com os usuários que mais
 * acessam, que realmente usam o sistema, o que mais está sendo usado, qual
 * o tempo de uso ativo com navegação real, horários de uso. Mostrar quem
 * não usa." O rastreamento (UsageTracker), a coleta e o endpoint agregado
 * já existiam desde 2026-08-29 — só a tela nunca tinha sido construída
 * (achado do usuário 2026-09-11: "ainda não consegui encontrar o local").
 * Ver design em docs/superpowers/specs/2026-08-29-estatisticas-uso-design.md.
 */
export default function EstatisticasUsoPage() {
  const [from, setFrom] = useState(primeiroDiaDoMes())
  const [to, setTo] = useState(hojeStr())
  const [data, setData] = useState<EstatisticasUsoData | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')

  const carregar = useCallback(async () => {
    setLoading(true)
    setErro('')
    const res = await fetch(`/api/estatisticas-uso/data?from=${from}&to=${to}`)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setErro(body.error ?? 'Falha ao carregar estatísticas de uso')
      setData(null)
      setLoading(false)
      return
    }
    setData(await res.json())
    setLoading(false)
  }, [from, to])

  useEffect(() => {
    void carregar()
  }, [carregar])

  const colunasAcessos: SortableColumn<RankingAcesso>[] = [
    { key: 'nome', label: 'Usuário', sortValue: (r) => r.nome, render: (r) => r.nome },
    { key: 'logins', label: 'Logins no período', align: 'right', sortValue: (r) => r.logins, render: (r) => r.logins.toLocaleString('pt-BR') },
  ]
  const colunasUsoReal: SortableColumn<RankingUso>[] = [
    { key: 'nome', label: 'Usuário', sortValue: (r) => r.nome, render: (r) => r.nome },
    {
      key: 'minutosAtivos',
      label: 'Tempo ativo (navegação real)',
      align: 'right',
      sortValue: (r) => r.minutosAtivos,
      render: (r) => fmtMinutos(r.minutosAtivos),
    },
  ]
  const colunasInativos: SortableColumn<UsuarioInativo>[] = [
    { key: 'nome', label: 'Usuário', sortValue: (r) => r.nome, render: (r) => r.nome },
    { key: 'email', label: 'E-mail', sortValue: (r) => r.email, render: (r) => r.email },
    {
      key: 'ultimoLogin',
      label: 'Último login',
      sortValue: (r) => r.ultimoLogin ?? '',
      render: (r) => (r.ultimoLogin ? fmtDateBR(r.ultimoLogin) : <span className="text-red-700">nunca</span>),
    },
  ]

  const dadosModulo = (data?.moduloMaisUsado ?? []).map((m) => ({ name: nomeModulo(m.module), value: m.visualizacoes }))
  const dadosHorario = (data?.horarios ?? []).map((v, h) => ({ name: `${String(h).padStart(2, '0')}h`, value: v }))
  const moduloTop = data?.moduloMaisUsado[0]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Estatísticas de uso</h1>
        <p className="text-sm text-slate-500">
          Quem acessa, quem realmente usa (navegação/tempo ativo, não só login), o que é mais usado, horários de uso, e quem não usa.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <DateRangeInputs from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
        {loading && <span className="text-xs text-slate-500">carregando…</span>}
      </div>

      {erro && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}

      {data && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Usuários com login no período" valor={data.rankingAcessos.length} />
            <StatTile label="Usuários com uso real no período" valor={data.rankingUsoReal.length} sub="navegação/tempo ativo, não só login" />
            <StatTile label="Módulo mais usado" valor={moduloTop ? nomeModulo(moduloTop.module) : '—'} sub={moduloTop ? `${moduloTop.visualizacoes.toLocaleString('pt-BR')} visualizações` : undefined} />
            <StatTile label="Sem uso há 7+ dias" valor={data.quemNaoUsa.length} sub="relativo a hoje, não ao período filtrado" />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-4 py-3 font-medium">Ranking de acessos (logins)</div>
              <SortableTable
                columns={colunasAcessos}
                rows={data.rankingAcessos}
                rowKey={(r) => r.userId}
                defaultSortKey="logins"
                defaultSortDir="desc"
                emptyMessage="Nenhum login no período."
              />
            </div>
            <div className="rounded-xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-4 py-3 font-medium">Ranking de uso real (tempo ativo)</div>
              <SortableTable
                columns={colunasUsoReal}
                rows={data.rankingUsoReal}
                rowKey={(r) => r.userId}
                defaultSortKey="minutosAtivos"
                defaultSortDir="desc"
                emptyMessage="Nenhum uso real registrado no período."
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <BarChartCard titulo="Módulo mais usado (visualizações de página)" dados={dadosModulo} />
            <BarChartCard titulo="Horários de uso" dados={dadosHorario} />
          </div>

          <div className="rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-4 py-3 font-medium">
              Quem não usa (sem login há 7+ dias, ou nunca)
            </div>
            <SortableTable
              columns={colunasInativos}
              rows={data.quemNaoUsa}
              rowKey={(r) => r.userId}
              defaultSortKey="ultimoLogin"
              defaultSortDir="asc"
              emptyMessage="Todos os usuários ativos acessaram nos últimos 7 dias."
            />
          </div>
        </>
      )}
    </div>
  )
}
