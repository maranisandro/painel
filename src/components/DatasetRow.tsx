'use client'

import { Fragment, useState } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  id: string
  name: string
  code: string
  query: string
  dataSourceName: string
  dataSourceType: string
  incrementalField: string | null
  watermark: string | null
  intervalMinutes: number | null
  scheduleEnabled: boolean
  rowsCount: number
  lastRun: { status: string; startedAt: string; error: string | null } | null
  /** true quando outra sincronização (outro dataset, ou "Sincronizar tudo") já está rodando — pedido do usuário 2026-08-13: "clique em uma fonte... desabilite outras fontes" */
  disabled?: boolean
  onSyncStart?: () => void
  onSyncEnd?: () => void
}

/**
 * Linha editável de dataset (pedido do usuário 2026-08-05: "alterar as
 * consultas das fontes de dados para o tempo de execução ser digitado. Dar a
 * opção de alterar também a consulta") — antes a consulta e o agendamento só
 * existiam no banco (populados por `prisma/seed.ts`), sem nenhuma tela para
 * editar. Agora "editar consulta e agenda" abre um painel inline com a
 * consulta (textarea) e o tempo de execução em minutos entre sincronizações
 * (o único modelo de agendamento que existe hoje — `SyncSchedule.intervalMinutes`,
 * sem cron/horário fixo, por decisão explícita do usuário).
 */
export function DatasetRow({
  id,
  name,
  code,
  query,
  dataSourceName,
  dataSourceType,
  incrementalField,
  watermark,
  intervalMinutes,
  scheduleEnabled,
  rowsCount,
  lastRun,
  disabled,
  onSyncStart,
  onSyncEnd,
}: Props) {
  const router = useRouter()
  const [editando, setEditando] = useState(false)
  const [queryEditada, setQueryEditada] = useState(query)
  const [intervaloEditado, setIntervaloEditado] = useState(String(intervalMinutes ?? 60))
  const [habilitado, setHabilitado] = useState(scheduleEnabled)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [sincronizando, setSincronizando] = useState(false)
  const [resultadoSync, setResultadoSync] = useState<{ ok: boolean; mensagem: string } | null>(null)

  async function sincronizar() {
    setSincronizando(true)
    setResultadoSync(null)
    onSyncStart?.()
    try {
      const res = await fetch(`/api/datasets/${id}/sync`, { method: 'POST' })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Falha na sincronização')
      setResultadoSync({ ok: true, mensagem: `${body.rowsUpserted ?? 0} linha(s)` })
      router.refresh()
    } catch (err) {
      setResultadoSync({ ok: false, mensagem: err instanceof Error ? err.message : String(err) })
    } finally {
      setSincronizando(false)
      onSyncEnd?.()
    }
  }

  function cancelar() {
    setEditando(false)
    setQueryEditada(query)
    setIntervaloEditado(String(intervalMinutes ?? 60))
    setHabilitado(scheduleEnabled)
    setErro(null)
  }

  async function salvar() {
    const intervalo = Number(intervaloEditado)
    if (!Number.isInteger(intervalo) || intervalo < 1) {
      setErro('Tempo de execução precisa ser um número inteiro de minutos, mínimo 1.')
      return
    }
    if (!queryEditada.trim()) {
      setErro('A consulta não pode ficar vazia.')
      return
    }
    setSalvando(true)
    setErro(null)
    try {
      const res = await fetch(`/api/datasets/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: queryEditada, intervalMinutes: intervalo, enabled: habilitado }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Falha ao salvar')
      setEditando(false)
      router.refresh()
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Fragment>
      <tr className="border-t border-slate-100">
        <td className="px-4 py-3">
          <p className="font-medium">{name}</p>
          <p className="text-xs text-slate-500">{code}</p>
          <button type="button" onClick={() => setEditando((v) => !v)} className="mt-1 text-xs text-emerald-700 hover:underline">
            {editando ? 'fechar edição' : 'editar consulta e agenda'}
          </button>
        </td>
        <td className="px-4 py-3">
          {dataSourceName}
          <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{dataSourceType}</span>
        </td>
        <td className="px-4 py-3">
          {incrementalField ? (
            <span>
              {incrementalField}
              {watermark && (
                <span className="block text-xs text-slate-500">
                  ≥ {watermark.slice(0, 10).split('-').reverse().join('/')}
                </span>
              )}
            </span>
          ) : (
            <span className="text-slate-400">carga completa</span>
          )}
        </td>
        <td className="px-4 py-3">
          {intervalMinutes == null
            ? '—'
            : scheduleEnabled
              ? `a cada ${intervalMinutes} min`
              : `desativado (${intervalMinutes} min)`}
        </td>
        <td className="px-4 py-3">{rowsCount.toLocaleString('pt-BR')}</td>
        <td className="px-4 py-3">
          {lastRun ? (
            <span className={lastRun.status === 'ERROR' ? 'text-red-600' : 'text-emerald-700'}>
              {lastRun.status}
              <span className="block text-xs text-slate-500">{lastRun.startedAt}</span>
              {lastRun.status === 'ERROR' && lastRun.error && (
                <span className="mt-1 block max-w-xs whitespace-normal text-xs text-red-700">{lastRun.error}</span>
              )}
            </span>
          ) : (
            <span className="text-slate-400">nunca</span>
          )}
        </td>
        <td className="px-4 py-3">
          <button
            type="button"
            onClick={sincronizar}
            disabled={sincronizando || disabled}
            title={disabled ? 'Outra sincronização está em andamento' : undefined}
            className="rounded-md border border-emerald-700 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:border-slate-300 disabled:text-slate-400 disabled:hover:bg-transparent"
          >
            {sincronizando ? 'Sincronizando…' : 'Sincronizar'}
          </button>
          {resultadoSync && (
            <p className={`mt-1 max-w-[10rem] whitespace-normal text-xs ${resultadoSync.ok ? 'text-emerald-700' : 'text-red-600'}`}>
              {resultadoSync.mensagem}
            </p>
          )}
        </td>
      </tr>
      {editando && (
        <tr className="border-t border-slate-100 bg-slate-50">
          <td colSpan={7} className="px-4 py-4">
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600">Consulta (SQL Oracle/MySQL ou caminho do webservice)</label>
                <textarea
                  value={queryEditada}
                  onChange={(e) => setQueryEditada(e.target.value)}
                  rows={10}
                  spellCheck={false}
                  className="mt-1 w-full rounded-md border border-slate-300 p-2 font-mono text-xs"
                />
              </div>
              <div className="flex flex-wrap items-end gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600">Tempo de execução (minutos entre sincronizações)</label>
                  <input
                    type="number"
                    min={1}
                    value={intervaloEditado}
                    onChange={(e) => setIntervaloEditado(e.target.value)}
                    className="mt-1 w-32 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  />
                </div>
                <label className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={habilitado}
                    onChange={(e) => setHabilitado(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
                  />
                  Agendamento automático ativo
                </label>
              </div>
              {erro && <p className="text-xs text-red-600">{erro}</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={salvar}
                  disabled={salvando}
                  className="rounded-md bg-emerald-700 px-4 py-1.5 text-sm text-white hover:bg-emerald-800 disabled:opacity-50"
                >
                  {salvando ? 'Salvando…' : 'Salvar'}
                </button>
                <button
                  type="button"
                  onClick={cancelar}
                  className="rounded-md border border-slate-300 px-4 py-1.5 text-sm hover:bg-slate-100"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  )
}
