'use client'

import { useCallback, useEffect, useState } from 'react'
import { SortableTable, type SortableColumn } from '@/components/shared/SortableTable'
import { TIPOS_TRANSPORTE_CONHECIDOS } from '@/lib/transporte/tipos'

interface RuleRecord {
  id: string
  tipo: string
  prioridade: number
  codtmv: string | null
  produtos: string | null
  origemColigada: number | null
  origemFilial: number | null
  destinoColigada: number | null
  destinoFilial: number | null
  ativo: boolean
}

const EMPTY = {
  tipo: '',
  prioridade: '0',
  codtmv: '',
  produtos: '',
  origemColigada: '',
  origemFilial: '',
  destinoColigada: '',
  destinoFilial: '',
  ativo: true,
}

function numOrNull(v: string): number | null {
  if (v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export default function RegrasTransportePage() {
  const [rules, setRules] = useState<RuleRecord[]>([])
  const [form, setForm] = useState(EMPTY)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/transport-type-rules')
    if (res.ok) setRules(await res.json())
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  function startEdit(r: RuleRecord) {
    setEditingId(r.id)
    setForm({
      tipo: r.tipo,
      prioridade: String(r.prioridade),
      codtmv: r.codtmv ?? '',
      produtos: r.produtos ?? '',
      origemColigada: r.origemColigada != null ? String(r.origemColigada) : '',
      origemFilial: r.origemFilial != null ? String(r.origemFilial) : '',
      destinoColigada: r.destinoColigada != null ? String(r.destinoColigada) : '',
      destinoFilial: r.destinoFilial != null ? String(r.destinoFilial) : '',
      ativo: r.ativo,
    })
    setError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const payload = {
      tipo: form.tipo,
      prioridade: Number(form.prioridade) || 0,
      codtmv: form.codtmv === '' ? null : form.codtmv,
      produtos: form.produtos === '' ? null : form.produtos,
      origemColigada: numOrNull(form.origemColigada),
      origemFilial: numOrNull(form.origemFilial),
      destinoColigada: numOrNull(form.destinoColigada),
      destinoFilial: numOrNull(form.destinoFilial),
      ativo: form.ativo,
    }
    const res = await fetch(editingId ? `/api/admin/transport-type-rules/${editingId}` : '/api/admin/transport-type-rules', {
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
    if (!confirm('Excluir esta regra?')) return
    const res = await fetch(`/api/admin/transport-type-rules/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Falha ao excluir')
      return
    }
    load()
  }

  const columns: SortableColumn<RuleRecord>[] = [
    { key: 'prioridade', label: 'Prioridade', sortValue: (r) => r.prioridade, render: (r) => r.prioridade },
    { key: 'tipo', label: 'Tipo', sortValue: (r) => r.tipo, render: (r) => <span className="font-medium">{r.tipo}</span> },
    { key: 'codtmv', label: 'CODTMV', sortValue: (r) => r.codtmv ?? '', render: (r) => r.codtmv ?? 'qualquer' },
    { key: 'produtos', label: 'Produtos', sortValue: (r) => r.produtos ?? '', render: (r) => r.produtos ?? 'qualquer' },
    {
      key: 'origem',
      label: 'Origem (coligada/filial)',
      sortValue: (r) => `${r.origemColigada ?? ''}.${r.origemFilial ?? ''}`,
      render: (r) => (r.origemColigada != null || r.origemFilial != null ? `${r.origemColigada ?? '*'}.${r.origemFilial ?? '*'}` : 'qualquer'),
    },
    {
      key: 'destino',
      label: 'Destino (coligada/filial)',
      sortValue: (r) => `${r.destinoColigada ?? ''}.${r.destinoFilial ?? ''}`,
      render: (r) => (r.destinoColigada != null || r.destinoFilial != null ? `${r.destinoColigada ?? '*'}.${r.destinoFilial ?? '*'}` : 'qualquer'),
    },
    { key: 'ativo', label: 'Situação', sortValue: (r) => (r.ativo ? 1 : 0), render: (r) => (r.ativo ? 'Ativa' : 'Inativa') },
    {
      key: 'acoes',
      label: '',
      sortValue: () => 0,
      render: (r) => (
        <span className="whitespace-nowrap">
          <button onClick={() => startEdit(r)} className="text-emerald-700 hover:underline">
            Editar
          </button>
          <button onClick={() => remove(r.id)} className="ml-3 text-red-600 hover:underline">
            Excluir
          </button>
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Regras de Transporte</h1>
        <p className="text-sm text-slate-500">
          Classifica cada movimentação do dataset de transporte interno em um tipo de negócio (venda rodoviária,
          transferência interna, madeira para carvão, madeira para tratamento). Testadas em ordem de prioridade —
          a primeira regra cujos campos preenchidos batem com a movimentação vence. Campo em branco = não filtra
          por isso.
        </p>
      </div>

      <form onSubmit={save} className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-medium">{editingId ? 'Editar regra' : 'Nova regra'}</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div>
            <label className="block text-xs font-medium text-slate-600">Tipo</label>
            <input
              required
              list="tipos-conhecidos"
              value={form.tipo}
              onChange={(e) => setForm({ ...form, tipo: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
            <datalist id="tipos-conhecidos">
              {TIPOS_TRANSPORTE_CONHECIDOS.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.label}
                </option>
              ))}
            </datalist>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Prioridade</label>
            <input
              type="number"
              value={form.prioridade}
              onChange={(e) => setForm({ ...form, prioridade: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">CODTMV (vazio = qualquer)</label>
            <input
              value={form.codtmv}
              onChange={(e) => setForm({ ...form, codtmv: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 font-mono text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Produtos (CODIGOPRD, vírgula; vazio = qualquer)</label>
            <input
              value={form.produtos}
              onChange={(e) => setForm({ ...form, produtos: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 font-mono text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Origem — coligada</label>
            <input
              type="number"
              value={form.origemColigada}
              onChange={(e) => setForm({ ...form, origemColigada: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Origem — filial</label>
            <input
              type="number"
              value={form.origemFilial}
              onChange={(e) => setForm({ ...form, origemFilial: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Destino — coligada</label>
            <input
              type="number"
              value={form.destinoColigada}
              onChange={(e) => setForm({ ...form, destinoColigada: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Destino — filial</label>
            <input
              type="number"
              value={form.destinoFilial}
              onChange={(e) => setForm({ ...form, destinoFilial: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.ativo}
              onChange={(e) => setForm({ ...form, ativo: e.target.checked })}
              className="h-3.5 w-3.5"
            />
            Ativa
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
        <div className="border-b border-slate-100 px-4 py-3 font-medium">Regras cadastradas ({rules.length})</div>
        <SortableTable columns={columns} rows={rules} rowKey={(r) => r.id} defaultSortKey="prioridade" defaultSortDir="asc" emptyMessage="Nenhuma regra cadastrada." />
      </div>
    </div>
  )
}
