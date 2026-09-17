'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { SortableTable, type SortableColumn } from '@/components/shared/SortableTable'

interface VehicleRecord {
  id: string
  placa: string
  precisaRastreamento: boolean
  codTra: string | null
  ativo: boolean
  observacoes: string | null
}

const EMPTY = { placa: '', precisaRastreamento: true, codTra: '', ativo: true, observacoes: '' }

export default function VeiculosPage() {
  const [vehicles, setVehicles] = useState<VehicleRecord[]>([])
  const [form, setForm] = useState(EMPTY)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState('')

  const filtered = useMemo(() => {
    const f = filter.trim().toUpperCase()
    if (!f) return vehicles
    return vehicles.filter((v) => [v.placa, v.codTra, v.observacoes].filter(Boolean).some((s) => String(s).toUpperCase().includes(f)))
  }, [vehicles, filter])

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/vehicles')
    if (res.ok) setVehicles(await res.json())
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  function startEdit(v: VehicleRecord) {
    setEditingId(v.id)
    setForm({
      placa: v.placa,
      precisaRastreamento: v.precisaRastreamento,
      codTra: v.codTra ?? '',
      ativo: v.ativo,
      observacoes: v.observacoes ?? '',
    })
    setError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const payload: Record<string, unknown> = {
      precisaRastreamento: form.precisaRastreamento,
      codTra: form.codTra === '' ? null : form.codTra,
      ativo: form.ativo,
      observacoes: form.observacoes === '' ? null : form.observacoes,
    }
    if (!editingId) payload.placa = form.placa
    const res = await fetch(editingId ? `/api/admin/vehicles/${editingId}` : '/api/admin/vehicles', {
      method: editingId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
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

  async function remove(id: string) {
    if (!confirm('Excluir este veículo?')) return
    const res = await fetch(`/api/admin/vehicles/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Falha ao excluir')
      return
    }
    load()
  }

  const columns: SortableColumn<VehicleRecord>[] = [
    { key: 'placa', label: 'Placa', sortValue: (v) => v.placa, render: (v) => <span className="font-mono text-sm font-medium">{v.placa}</span> },
    {
      key: 'rastreamento',
      label: 'Rastreamento',
      sortValue: (v) => (v.precisaRastreamento ? 1 : 0),
      render: (v) =>
        v.precisaRastreamento ? (
          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">Omnilink</span>
        ) : (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">sem rastreamento</span>
        ),
    },
    { key: 'codTra', label: 'CODTRA', sortValue: (v) => v.codTra ?? '', render: (v) => v.codTra ?? '—' },
    {
      key: 'ativo',
      label: 'Situação',
      sortValue: (v) => (v.ativo ? 1 : 0),
      render: (v) => (v.ativo ? 'Ativo' : 'Inativo'),
    },
    { key: 'observacoes', label: 'Observações', sortValue: (v) => v.observacoes ?? '', render: (v) => v.observacoes ?? '—' },
    {
      key: 'acoes',
      label: '',
      sortValue: () => 0,
      render: (v) => (
        <span className="whitespace-nowrap">
          <button onClick={() => startEdit(v)} className="text-emerald-700 hover:underline">
            Editar
          </button>
          <button onClick={() => remove(v.id)} className="ml-3 text-red-600 hover:underline">
            Excluir
          </button>
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Veículos</h1>
        <p className="text-sm text-slate-500">
          Cadastro central da frota (placa) — complementa a resolução de transportadora já existente por CODTRA,
          só adicionando o que ainda não existe: registro por placa e se o veículo precisa reportar rastreamento
          (Omnilink) ou não.
        </p>
      </div>

      <form onSubmit={save} className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-medium">{editingId ? 'Editar veículo' : 'Novo veículo'}</h2>
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
            <label className="block text-xs font-medium text-slate-600">CODTRA (opcional)</label>
            <input
              value={form.codTra}
              onChange={(e) => setForm({ ...form, codTra: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-600">Observações</label>
            <input
              value={form.observacoes}
              onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.precisaRastreamento}
              onChange={(e) => setForm({ ...form, precisaRastreamento: e.target.checked })}
              className="h-3.5 w-3.5"
            />
            Precisa reportar rastreamento (Omnilink)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.ativo}
              onChange={(e) => setForm({ ...form, ativo: e.target.checked })}
              className="h-3.5 w-3.5"
            />
            Ativo
          </label>
        </div>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <div className="mt-3 flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-emerald-700 px-4 py-1.5 text-sm text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            {saving ? 'Salvando…' : editingId ? 'Salvar alterações' : 'Adicionar'}
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

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <span className="font-medium">Veículos cadastrados ({filtered.length})</span>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="filtrar placa, CODTRA, observações…"
            className="w-72 rounded-md border border-slate-300 px-2 py-1 text-sm"
          />
        </div>
        <SortableTable columns={columns} rows={filtered} rowKey={(v) => v.id} defaultSortKey="placa" defaultSortDir="asc" emptyMessage="Nenhum veículo cadastrado." />
      </div>
    </div>
  )
}
