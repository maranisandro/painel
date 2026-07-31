'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ExcelButtons } from '@/components/admin/ExcelButtons'

interface VacationRecord {
  id: string
  motorista: string
  startDate: string
  endDate: string | null
}

const EMPTY = { motorista: '', startDate: '', endDate: '' }
const BULK_EMPTY = { startDate: '', endDate: '' }

function fmtDate(iso: string | null): string {
  if (!iso) return 'em aberto'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function parseImportDate(raw: string): { ok: true; value: string | null } | { ok: false } {
  const v = raw.trim()
  if (!v) return { ok: true, value: null }
  const br = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (br) return { ok: true, value: `${br[3]}-${br[2]}-${br[1]}` }
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return { ok: true, value: v.slice(0, 10) }
  return { ok: false }
}

export default function FeriasPage() {
  const [records, setRecords] = useState<VacationRecord[]>([])
  const [form, setForm] = useState(EMPTY)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState('')

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkForm, setBulkForm] = useState(BULK_EMPTY)
  const [bulkSaving, setBulkSaving] = useState(false)
  const [bulkMsg, setBulkMsg] = useState('')

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/driver-vacations')
    if (res.ok) setRecords(await res.json())
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const byMotorista = useMemo(() => {
    const map = new Map<string, VacationRecord[]>()
    for (const r of records) {
      if (filter && !r.motorista.toUpperCase().includes(filter.toUpperCase())) continue
      const list = map.get(r.motorista) ?? []
      list.push(r)
      map.set(r.motorista, list)
    }
    for (const list of map.values()) {
      list.sort((a, b) => b.startDate.localeCompare(a.startDate))
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [records, filter])

  function toggleSelected(motorista: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(motorista)) next.delete(motorista)
      else next.add(motorista)
      return next
    })
  }

  function startEdit(r: VacationRecord) {
    setEditingId(r.id)
    setForm({
      motorista: r.motorista,
      startDate: r.startDate.slice(0, 10),
      endDate: r.endDate ? r.endDate.slice(0, 10) : '',
    })
    setError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const payload = editingId
      ? { startDate: form.startDate, endDate: form.endDate === '' ? null : form.endDate }
      : {
          motorista: form.motorista,
          startDate: form.startDate,
          endDate: form.endDate === '' ? null : form.endDate,
        }
    const res = await fetch(
      editingId ? `/api/admin/driver-vacations/${editingId}` : '/api/admin/driver-vacations',
      {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    )
    setSaving(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Falha ao salvar')
      return
    }
    setForm(EMPTY)
    setEditingId(null)
    load()
  }

  async function retirarHoje(r: VacationRecord) {
    const res = await fetch(`/api/admin/driver-vacations/${r.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endDate: todayStr() }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Falha ao encerrar as férias')
      return
    }
    load()
  }

  async function remove(id: string) {
    if (!confirm('Excluir este registro de férias?')) return
    const res = await fetch(`/api/admin/driver-vacations/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Falha ao excluir')
      return
    }
    load()
  }

  // Sempre cria um novo período de férias para o motorista. Usado no bulk-edit e na importação.
  async function createVacation(
    motorista: string,
    startDate: string,
    endDate: string | null,
  ): Promise<{ ok: boolean; error?: string }> {
    const res = await fetch('/api/admin/driver-vacations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ motorista, startDate, endDate }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      return { ok: false, error: body.error ?? 'falha ao salvar' }
    }
    return { ok: true }
  }

  async function applyBulk(e: React.FormEvent) {
    e.preventDefault()
    if (selected.size === 0 || !bulkForm.startDate) return
    setBulkSaving(true)
    setBulkMsg('')
    const errors: string[] = []
    let ok = 0
    for (const motorista of selected) {
      const result = await createVacation(motorista, bulkForm.startDate, bulkForm.endDate === '' ? null : bulkForm.endDate)
      if (result.ok) ok++
      else errors.push(`${motorista}: ${result.error}`)
    }
    setBulkSaving(false)
    setSelected(new Set())
    setBulkForm(BULK_EMPTY)
    await load()
    setBulkMsg(
      errors.length
        ? `${ok} aplicada(s), ${errors.length} com erro: ${errors.slice(0, 3).join('; ')}${errors.length > 3 ? '…' : ''}`
        : `${ok} motorista(s) colocado(s) de férias.`,
    )
  }

  async function importVacations(rows: Record<string, string>[]): Promise<string> {
    let created = 0
    let skipped = 0
    const errors: string[] = []
    for (const row of rows) {
      const motorista = String(row['Motorista'] ?? '').trim().toUpperCase()
      const startRaw = String(row['Início'] ?? row['Inicio'] ?? '').trim()
      const endRaw = String(row['Fim'] ?? '').trim()
      if (!motorista || !startRaw) {
        skipped++
        continue
      }
      const start = parseImportDate(startRaw)
      const end = parseImportDate(endRaw)
      if (!start.ok || !start.value || !end.ok) {
        errors.push(`${motorista}: data inválida (use dd/mm/yyyy)`)
        continue
      }
      const result = await createVacation(motorista, start.value, end.value)
      if (result.ok) created++
      else errors.push(`${motorista}: ${result.error}`)
    }
    await load()
    const parts = [`${created} nova(s)`]
    if (skipped) parts.push(`${skipped} ignorada(s) (faltou motorista/início)`)
    if (errors.length) parts.push(`erros: ${errors.slice(0, 3).join('; ')}${errors.length > 3 ? '…' : ''}`)
    return parts.join(', ')
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Férias de motoristas</h1>
        <p className="text-sm text-slate-500">
          O motorista de férias continua contando no acompanhamento — o período serve para o
          painel explicar por que ele não teve viagens, sem confundir com afastamento não
          planejado.
        </p>
      </div>

      <form onSubmit={save} className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-medium">{editingId ? 'Editar férias' : 'Colocar de férias'}</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-3">
          <div>
            <label className="block text-xs font-medium text-slate-600">Motorista</label>
            <input
              required
              disabled={!!editingId}
              value={form.motorista}
              onChange={(e) => setForm({ ...form, motorista: e.target.value.toUpperCase() })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-100"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Início</label>
            <input
              required
              type="date"
              value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Fim (vazio = em aberto)</label>
            <input
              type="date"
              value={form.endDate}
              onChange={(e) => setForm({ ...form, endDate: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
        </div>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <div className="mt-3 flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-emerald-700 px-4 py-1.5 text-sm text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            {saving ? 'Salvando…' : editingId ? 'Salvar' : 'Adicionar'}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={() => {
                setEditingId(null)
                setForm(EMPTY)
              }}
              className="rounded-md border border-slate-300 px-4 py-1.5 text-sm hover:bg-slate-100"
            >
              Cancelar
            </button>
          )}
        </div>
      </form>

      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <span className="font-medium">Motoristas com férias registradas ({byMotorista.length})</span>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="filtrar motorista…"
              className="rounded-md border border-slate-300 px-2 py-1 text-sm"
            />
            <ExcelButtons
              exportFilename="ferias.xlsx"
              exportRows={() =>
                byMotorista.flatMap(([motorista, list]) =>
                  list.map((r) => ({
                    Motorista: motorista,
                    Início: fmtDate(r.startDate),
                    Fim: r.endDate ? fmtDate(r.endDate) : '',
                  })),
                )
              }
              onImport={importVacations}
            />
          </div>
        </div>
        <p className="border-b border-slate-100 px-4 py-2 text-[11px] text-slate-500">
          Importação espera as colunas <strong>Motorista</strong>, <strong>Início</strong> e{' '}
          <strong>Fim</strong> (vazio = em aberto), datas em dd/mm/yyyy — sempre cria um novo período.
        </p>

        {selected.size > 0 && (
          <form
            onSubmit={applyBulk}
            className="flex flex-wrap items-end gap-2 border-b border-slate-100 bg-emerald-50 px-4 py-3"
          >
            <span className="text-sm font-medium text-emerald-900">
              {selected.size} motorista(s) selecionado(s)
            </span>
            <div>
              <label className="block text-xs font-medium text-slate-600">Início</label>
              <input
                required
                type="date"
                value={bulkForm.startDate}
                onChange={(e) => setBulkForm({ ...bulkForm, startDate: e.target.value })}
                className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600">Fim (vazio = em aberto)</label>
              <input
                type="date"
                value={bulkForm.endDate}
                onChange={(e) => setBulkForm({ ...bulkForm, endDate: e.target.value })}
                className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={bulkSaving}
              className="rounded-md bg-emerald-700 px-4 py-1.5 text-sm text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              {bulkSaving ? 'Aplicando…' : `Aplicar a ${selected.size} motorista(s)`}
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="rounded-md border border-slate-300 px-4 py-1.5 text-sm hover:bg-white"
            >
              Limpar seleção
            </button>
          </form>
        )}
        {bulkMsg && <p className="border-b border-slate-100 px-4 py-2 text-xs text-slate-600">{bulkMsg}</p>}

        <div className="divide-y divide-slate-100">
          {byMotorista.map(([motorista, list]) => (
            <div key={motorista} className="flex flex-wrap items-center gap-2 px-4 py-2">
              <input
                type="checkbox"
                checked={selected.has(motorista)}
                onChange={() => toggleSelected(motorista)}
                className="h-3.5 w-3.5 shrink-0"
              />
              <span className="w-48 shrink-0 text-sm font-medium">{motorista}</span>
              <div className="flex flex-wrap items-center gap-1 text-sm">
                {list.map((r) => (
                  <span key={r.id} className="flex items-center gap-1">
                    <span
                      className={`rounded px-2 py-0.5 ${r.endDate ? 'bg-slate-100 text-slate-700' : 'bg-cyan-100 text-cyan-900'}`}
                    >
                      {fmtDate(r.startDate)} → {fmtDate(r.endDate)}
                    </span>
                    {!r.endDate && (
                      <button onClick={() => retirarHoje(r)} className="text-xs text-emerald-700 hover:underline">
                        encerrar hoje
                      </button>
                    )}
                    <button onClick={() => startEdit(r)} className="text-xs text-emerald-700 hover:underline">
                      editar
                    </button>
                    <button onClick={() => remove(r.id)} className="text-xs text-red-600 hover:underline">
                      excluir
                    </button>
                  </span>
                ))}
              </div>
            </div>
          ))}
          {byMotorista.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-slate-500">
              Nenhuma férias registrada.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
