'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ExcelButtons } from '@/components/admin/ExcelButtons'

interface MaintenanceRecord {
  id: string
  placa: string
  startDate: string
  endDate: string | null
  motivo: string | null
}

const EMPTY = { placa: '', startDate: '', endDate: '', motivo: '' }
const BULK_EMPTY = { startDate: '', endDate: '', motivo: '' }

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

export default function ManutencaoPage() {
  const [records, setRecords] = useState<MaintenanceRecord[]>([])
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
    const res = await fetch('/api/admin/vehicle-maintenance')
    if (res.ok) setRecords(await res.json())
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const byPlaca = useMemo(() => {
    const map = new Map<string, MaintenanceRecord[]>()
    for (const r of records) {
      if (filter && ![r.placa, r.motivo].filter(Boolean).some((v) => String(v).toUpperCase().includes(filter.toUpperCase()))) continue
      const list = map.get(r.placa) ?? []
      list.push(r)
      map.set(r.placa, list)
    }
    for (const list of map.values()) {
      list.sort((a, b) => b.startDate.localeCompare(a.startDate))
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [records, filter])

  function toggleSelected(placa: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(placa)) next.delete(placa)
      else next.add(placa)
      return next
    })
  }

  function startEdit(r: MaintenanceRecord) {
    setEditingId(r.id)
    setForm({
      placa: r.placa,
      startDate: r.startDate.slice(0, 10),
      endDate: r.endDate ? r.endDate.slice(0, 10) : '',
      motivo: r.motivo ?? '',
    })
    setError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const payload = editingId
      ? {
          startDate: form.startDate,
          endDate: form.endDate === '' ? null : form.endDate,
          motivo: form.motivo === '' ? null : form.motivo,
        }
      : {
          placa: form.placa,
          startDate: form.startDate,
          endDate: form.endDate === '' ? null : form.endDate,
          motivo: form.motivo === '' ? null : form.motivo,
        }
    const res = await fetch(
      editingId ? `/api/admin/vehicle-maintenance/${editingId}` : '/api/admin/vehicle-maintenance',
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

  async function retirarHoje(r: MaintenanceRecord) {
    const res = await fetch(`/api/admin/vehicle-maintenance/${r.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endDate: todayStr() }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Falha ao retirar da manutenção')
      return
    }
    load()
  }

  async function remove(id: string) {
    if (!confirm('Excluir este registro de manutenção?')) return
    const res = await fetch(`/api/admin/vehicle-maintenance/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Falha ao excluir')
      return
    }
    load()
  }

  // Sempre cria um novo período de manutenção para a placa (cada placa pode ter vários
  // períodos ao longo do tempo). Usado no bulk-edit e na importação.
  async function createMaintenance(
    placa: string,
    startDate: string,
    endDate: string | null,
    motivo: string | null,
  ): Promise<{ ok: boolean; error?: string }> {
    const res = await fetch('/api/admin/vehicle-maintenance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ placa, startDate, endDate, motivo }),
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
    for (const placa of selected) {
      const result = await createMaintenance(
        placa,
        bulkForm.startDate,
        bulkForm.endDate === '' ? null : bulkForm.endDate,
        bulkForm.motivo === '' ? null : bulkForm.motivo,
      )
      if (result.ok) ok++
      else errors.push(`${placa}: ${result.error}`)
    }
    setBulkSaving(false)
    setSelected(new Set())
    setBulkForm(BULK_EMPTY)
    await load()
    setBulkMsg(
      errors.length
        ? `${ok} aplicada(s), ${errors.length} com erro: ${errors.slice(0, 3).join('; ')}${errors.length > 3 ? '…' : ''}`
        : `${ok} placa(s) colocada(s) em manutenção.`,
    )
  }

  async function importMaintenance(rows: Record<string, string>[]): Promise<string> {
    let created = 0
    let skipped = 0
    const errors: string[] = []
    for (const row of rows) {
      const placa = String(row['Placa'] ?? '').trim().toUpperCase()
      const startRaw = String(row['Início'] ?? row['Inicio'] ?? '').trim()
      const endRaw = String(row['Fim'] ?? '').trim()
      const motivo = String(row['Motivo'] ?? '').trim() || null
      if (!placa || !startRaw) {
        skipped++
        continue
      }
      const start = parseImportDate(startRaw)
      const end = parseImportDate(endRaw)
      if (!start.ok || !start.value || !end.ok) {
        errors.push(`${placa}: data inválida (use dd/mm/yyyy)`)
        continue
      }
      const result = await createMaintenance(placa, start.value, end.value, motivo)
      if (result.ok) created++
      else errors.push(`${placa}: ${result.error}`)
    }
    await load()
    const parts = [`${created} nova(s)`]
    if (skipped) parts.push(`${skipped} ignorada(s) (faltou placa/início)`)
    if (errors.length) parts.push(`erros: ${errors.slice(0, 3).join('; ')}${errors.length > 3 ? '…' : ''}`)
    return parts.join(', ')
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Manutenção de caminhões</h1>
        <p className="text-sm text-slate-500">
          O caminhão em manutenção continua contando na meta/ritmo esperado (ele deveria estar
          rodando) — o período serve só para o painel explicar o desvio de performance, mostrando
          quanto a manutenção influenciou o resultado.
        </p>
      </div>

      <form onSubmit={save} className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-medium">
          {editingId ? 'Editar manutenção' : 'Colocar em manutenção'}
        </h2>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div>
            <label className="block text-xs font-medium text-slate-600">Placa</label>
            <input
              required
              disabled={!!editingId}
              value={form.placa}
              onChange={(e) => setForm({ ...form, placa: e.target.value.toUpperCase() })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 font-mono text-sm disabled:bg-slate-100"
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
          <div>
            <label className="block text-xs font-medium text-slate-600">Motivo</label>
            <input
              value={form.motivo}
              onChange={(e) => setForm({ ...form, motivo: e.target.value })}
              placeholder="ex.: revisão, pneu, funilaria"
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
          <span className="font-medium">Placas com manutenção registrada ({byPlaca.length})</span>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="filtrar placa ou motivo…"
              className="rounded-md border border-slate-300 px-2 py-1 text-sm"
            />
            <ExcelButtons
              exportFilename="manutencao.xlsx"
              exportRows={() =>
                byPlaca.flatMap(([placa, list]) =>
                  list.map((r) => ({
                    Placa: placa,
                    Início: fmtDate(r.startDate),
                    Fim: r.endDate ? fmtDate(r.endDate) : '',
                    Motivo: r.motivo ?? '',
                  })),
                )
              }
              onImport={importMaintenance}
            />
          </div>
        </div>
        <p className="border-b border-slate-100 px-4 py-2 text-[11px] text-slate-500">
          Importação espera as colunas <strong>Placa</strong>, <strong>Início</strong>, <strong>Fim</strong>{' '}
          (vazio = em aberto) e <strong>Motivo</strong> (dd/mm/yyyy) — sempre cria um novo período.
        </p>

        {selected.size > 0 && (
          <form
            onSubmit={applyBulk}
            className="flex flex-wrap items-end gap-2 border-b border-slate-100 bg-emerald-50 px-4 py-3"
          >
            <span className="text-sm font-medium text-emerald-900">{selected.size} placa(s) selecionada(s)</span>
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
            <div>
              <label className="block text-xs font-medium text-slate-600">Motivo</label>
              <input
                value={bulkForm.motivo}
                onChange={(e) => setBulkForm({ ...bulkForm, motivo: e.target.value })}
                placeholder="ex.: parada preventiva coletiva"
                className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={bulkSaving}
              className="rounded-md bg-emerald-700 px-4 py-1.5 text-sm text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              {bulkSaving ? 'Aplicando…' : `Aplicar a ${selected.size} placa(s)`}
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
          {byPlaca.map(([placa, list]) => (
            <div key={placa} className="flex flex-wrap items-center gap-2 px-4 py-2">
              <input
                type="checkbox"
                checked={selected.has(placa)}
                onChange={() => toggleSelected(placa)}
                className="h-3.5 w-3.5 shrink-0"
              />
              <span className="w-24 shrink-0 font-mono text-sm font-medium">{placa}</span>
              <div className="flex flex-wrap items-center gap-1 text-sm">
                {list.map((r) => (
                  <span key={r.id} className="flex items-center gap-1">
                    <span
                      className={`rounded px-2 py-0.5 ${r.endDate ? 'bg-slate-100 text-slate-700' : 'bg-amber-100 text-amber-900'}`}
                    >
                      {fmtDate(r.startDate)} → {fmtDate(r.endDate)}
                      {r.motivo && <span className="ml-1 text-xs text-slate-500">({r.motivo})</span>}
                    </span>
                    {!r.endDate && (
                      <button onClick={() => retirarHoje(r)} className="text-xs text-emerald-700 hover:underline">
                        retirar hoje
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
          {byPlaca.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-slate-500">
              Nenhuma manutenção registrada.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
