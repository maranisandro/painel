'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

interface Parameter {
  id: string
  code: string
  name: string
  description: string | null
  valueNumber: string | null
  valueText: string | null
  formula: string | null
}

const EMPTY = { code: '', name: '', description: '', valueNumber: '', valueText: '', formula: '' }

export default function ParametrosPage() {
  const [parameters, setParameters] = useState<Parameter[]>([])
  const [form, setForm] = useState(EMPTY)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState('')

  const filteredParameters = useMemo(() => {
    const f = filter.trim().toUpperCase()
    if (!f) return parameters
    return parameters.filter((p) =>
      [p.code, p.name, p.description, p.formula].filter(Boolean).some((v) => String(v).toUpperCase().includes(f)),
    )
  }, [parameters, filter])

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/parameters')
    if (res.ok) setParameters(await res.json())
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  function startEdit(p: Parameter) {
    setEditingId(p.id)
    setForm({
      code: p.code,
      name: p.name,
      description: p.description ?? '',
      valueNumber: p.valueNumber ? String(Number(p.valueNumber)) : '',
      valueText: p.valueText ?? '',
      formula: p.formula ?? '',
    })
    setError('')
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const payload: Record<string, unknown> = {
      name: form.name,
      description: form.description === '' ? null : form.description,
      valueNumber: form.valueNumber === '' ? null : Number(form.valueNumber),
      valueText: form.valueText === '' ? null : form.valueText,
      formula: form.formula === '' ? null : form.formula,
    }
    if (!editingId) payload.code = form.code
    const res = await fetch(editingId ? `/api/admin/parameters/${editingId}` : '/api/admin/parameters', {
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
    if (!confirm('Excluir este parâmetro?')) return
    const res = await fetch(`/api/admin/parameters/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Falha ao excluir')
      return
    }
    load()
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Parâmetros</h1>
        <p className="text-sm text-slate-500">
          Valores e fórmulas dos painéis. Fórmulas aceitam + - * / ( ), outros parâmetros pelo código e
          as variáveis <code className="rounded bg-slate-100 px-1">diasDoMes</code> e{' '}
          <code className="rounded bg-slate-100 px-1">diaDoMes</code>.
        </p>
      </div>

      <form onSubmit={save} className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-medium">{editingId ? 'Editar parâmetro' : 'Novo parâmetro'}</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <div>
            <label className="block text-xs font-medium text-slate-600">Código</label>
            <input
              required
              disabled={!!editingId}
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              placeholder="META_KM_MES"
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-100"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Nome</label>
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Valor numérico</label>
            <input
              type="number" step="any"
              value={form.valueNumber}
              onChange={(e) => setForm({ ...form, valueNumber: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-600">Fórmula</label>
            <input
              value={form.formula}
              onChange={(e) => setForm({ ...form, formula: e.target.value })}
              placeholder="META_KM_MES / diasDoMes * diaDoMes"
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 font-mono text-sm"
            />
          </div>
          <div className="col-span-2 lg:col-span-5">
            <label className="block text-xs font-medium text-slate-600">Descrição</label>
            <input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
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
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <span className="font-medium">Parâmetros cadastrados ({filteredParameters.length})</span>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="filtrar código, nome, fórmula…"
            className="w-72 rounded-md border border-slate-300 px-2 py-1 text-sm"
          />
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              <th className="px-3 py-2">Código</th>
              <th className="px-3 py-2">Nome</th>
              <th className="px-3 py-2 text-right">Valor</th>
              <th className="px-3 py-2">Fórmula</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {filteredParameters.map((p) => (
              <tr key={p.id} className="border-t border-slate-100">
                <td className="px-3 py-2 font-mono text-xs">{p.code}</td>
                <td className="px-3 py-2">{p.name}</td>
                <td className="px-3 py-2 text-right">
                  {p.valueNumber ? Number(p.valueNumber).toLocaleString('pt-BR') : '—'}
                </td>
                <td className="px-3 py-2 font-mono text-xs">{p.formula ?? '—'}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <button onClick={() => startEdit(p)} className="text-emerald-700 hover:underline">
                    Editar
                  </button>
                  <button onClick={() => remove(p.id)} className="ml-3 text-red-600 hover:underline">
                    Excluir
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
