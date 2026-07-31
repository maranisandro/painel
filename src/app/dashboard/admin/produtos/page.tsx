'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ExcelButtons } from '@/components/admin/ExcelButtons'

interface ProductTypeRecord {
  id: string
  codigoPrd: string
  produtoNome: string | null
  tipoProduto: string
  active: boolean
}

interface PendingProduct {
  codigoPrd: string
  produtoNome: string
  movimentos: number
}

const TIPOS_CONHECIDOS = ['Carvão', 'Cavaco', 'Maravalha', 'Madeira Tratada', 'Outros']

const EMPTY = { codigoPrd: '', produtoNome: '', tipoProduto: '' }
const BULK_EMPTY = { tipoProduto: '' }

export default function ProdutosPage() {
  const [productTypes, setProductTypes] = useState<ProductTypeRecord[]>([])
  const [pending, setPending] = useState<PendingProduct[]>([])
  const [form, setForm] = useState(EMPTY)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState('')

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkForm, setBulkForm] = useState(BULK_EMPTY)
  const [bulkSaving, setBulkSaving] = useState(false)
  const [bulkMsg, setBulkMsg] = useState('')

  const filteredProductTypes = useMemo(() => {
    const f = filter.trim().toUpperCase()
    if (!f) return productTypes
    return productTypes.filter((p) =>
      [p.codigoPrd, p.produtoNome, p.tipoProduto].filter(Boolean).some((v) => String(v).toUpperCase().includes(f)),
    )
  }, [productTypes, filter])

  const load = useCallback(async () => {
    const [pt, pd] = await Promise.all([
      fetch('/api/admin/product-types'),
      fetch('/api/admin/product-types/pending'),
    ])
    if (pt.ok) setProductTypes(await pt.json())
    if (pd.ok) setPending(await pd.json())
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  function toggleSelected(codigoPrd: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(codigoPrd)) next.delete(codigoPrd)
      else next.add(codigoPrd)
      return next
    })
  }

  function startEdit(p: ProductTypeRecord) {
    setEditingId(p.id)
    setForm({ codigoPrd: p.codigoPrd, produtoNome: p.produtoNome ?? '', tipoProduto: p.tipoProduto })
    setError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function startFromPending(p: PendingProduct) {
    setEditingId(null)
    setForm({ codigoPrd: p.codigoPrd, produtoNome: p.produtoNome, tipoProduto: '' })
    setError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const payload: Record<string, unknown> = {
      produtoNome: form.produtoNome === '' ? null : form.produtoNome,
      tipoProduto: form.tipoProduto,
    }
    if (!editingId) payload.codigoPrd = form.codigoPrd
    const res = await fetch(
      editingId ? `/api/admin/product-types/${editingId}` : '/api/admin/product-types',
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

  async function remove(id: string) {
    if (!confirm('Excluir esta classificação de produto?')) return
    const res = await fetch(`/api/admin/product-types/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Falha ao excluir')
      return
    }
    load()
  }

  // Cria (código novo/pendente) ou atualiza (código já classificado) a classificação de um
  // produto. Usado no bulk-edit e na importação por Excel.
  async function upsertProductType(
    codigoPrd: string,
    produtoNome: string | null,
    tipoProduto: string,
    currentTypes: ProductTypeRecord[],
  ): Promise<{ ok: boolean; created: boolean; error?: string }> {
    const existing = currentTypes.find((p) => p.codigoPrd === codigoPrd)
    const payload = existing
      ? { produtoNome, tipoProduto }
      : { codigoPrd, produtoNome, tipoProduto }
    const res = await fetch(existing ? `/api/admin/product-types/${existing.id}` : '/api/admin/product-types', {
      method: existing ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      return { ok: false, created: false, error: body.error ?? 'falha ao salvar' }
    }
    return { ok: true, created: !existing }
  }

  async function applyBulk(e: React.FormEvent) {
    e.preventDefault()
    if (selected.size === 0 || !bulkForm.tipoProduto) return
    setBulkSaving(true)
    setBulkMsg('')
    const errors: string[] = []
    let ok = 0
    for (const codigoPrd of selected) {
      const existing = productTypes.find((p) => p.codigoPrd === codigoPrd)
      const pend = pending.find((p) => p.codigoPrd === codigoPrd)
      const produtoNome = existing?.produtoNome ?? pend?.produtoNome ?? null
      const result = await upsertProductType(codigoPrd, produtoNome, bulkForm.tipoProduto, productTypes)
      if (result.ok) ok++
      else errors.push(`${codigoPrd}: ${result.error}`)
    }
    setBulkSaving(false)
    setSelected(new Set())
    setBulkForm(BULK_EMPTY)
    await load()
    setBulkMsg(
      errors.length
        ? `${ok} aplicada(s), ${errors.length} com erro: ${errors.slice(0, 3).join('; ')}${errors.length > 3 ? '…' : ''}`
        : `${ok} produto(s) classificado(s).`,
    )
  }

  async function importProducts(rows: Record<string, string>[]): Promise<string> {
    let created = 0
    let updated = 0
    let skipped = 0
    const errors: string[] = []
    let snapshot = productTypes
    for (const row of rows) {
      const codigoPrd = String(row['Código'] ?? row['Codigo'] ?? row['CODIGOPRD'] ?? '').trim()
      const produtoNome = String(row['Nome (ERP)'] ?? row['Nome'] ?? '').trim() || null
      const tipoProduto = String(row['Classificação'] ?? row['Classificacao'] ?? '').trim()
      if (!codigoPrd || !tipoProduto) {
        skipped++
        continue
      }
      const result = await upsertProductType(codigoPrd, produtoNome, tipoProduto, snapshot)
      if (result.ok) {
        if (result.created) created++
        else updated++
      } else {
        errors.push(`${codigoPrd}: ${result.error}`)
      }
    }
    const res = await fetch('/api/admin/product-types')
    if (res.ok) {
      snapshot = await res.json()
      setProductTypes(snapshot)
    }
    const pd = await fetch('/api/admin/product-types/pending')
    if (pd.ok) setPending(await pd.json())
    const parts = [`${created} nova(s)`, `${updated} atualizada(s)`]
    if (skipped) parts.push(`${skipped} ignorada(s) (faltou código/classificação)`)
    if (errors.length) parts.push(`erros: ${errors.slice(0, 3).join('; ')}${errors.length > 3 ? '…' : ''}`)
    return parts.join(', ')
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Produtos</h1>
        <p className="text-sm text-slate-500">
          Classificação de produto (Carvão, Cavaco, Maravalha, Outros…) por código do ERP
          (CODIGOPRD) — substitui a antiga regra fixa por trecho do nome. Usada no filtro
          &quot;Produto&quot; do painel de Transporte Rodoviário (clique filtra, Ctrl+clique agrupa
          para análise conjunta).
        </p>
      </div>

      {pending.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          <h2 className="font-medium text-amber-900">
            Produtos sem classificação ({pending.length})
          </h2>
          <p className="mt-1 text-sm text-amber-800">
            Apareceram na sincronização mas ainda não têm cadastro — hoje contam como
            &quot;Outros&quot; no painel. Marque vários e classifique todos de uma vez, ou use
            &quot;Classificar&quot; para um só.
          </p>
          <div className="mt-3 divide-y divide-amber-200">
            {pending.map((p) => (
              <div key={p.codigoPrd} className="flex items-center justify-between gap-2 py-2 text-sm">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selected.has(p.codigoPrd)}
                    onChange={() => toggleSelected(p.codigoPrd)}
                    className="h-3.5 w-3.5"
                  />
                  <span className="font-mono text-xs text-amber-900">{p.codigoPrd}</span>
                  <span className="ml-2">{p.produtoNome}</span>
                  <span className="ml-2 text-xs text-amber-700">({p.movimentos} movimentos)</span>
                </div>
                <button
                  onClick={() => startFromPending(p)}
                  className="rounded-md border border-amber-400 px-3 py-1 text-xs text-amber-900 hover:bg-amber-100"
                >
                  Classificar
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <form onSubmit={save} className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-medium">{editingId ? 'Editar classificação' : 'Nova classificação'}</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div>
            <label className="block text-xs font-medium text-slate-600">Código (CODIGOPRD)</label>
            <input
              required
              disabled={!!editingId}
              value={form.codigoPrd}
              onChange={(e) => setForm({ ...form, codigoPrd: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 font-mono text-sm disabled:bg-slate-100"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-600">Nome do produto (ERP)</label>
            <input
              value={form.produtoNome}
              onChange={(e) => setForm({ ...form, produtoNome: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Classificação</label>
            <input
              required
              list="tipos-conhecidos"
              value={form.tipoProduto}
              onChange={(e) => setForm({ ...form, tipoProduto: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
            <datalist id="tipos-conhecidos">
              {TIPOS_CONHECIDOS.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
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

      {selected.size > 0 && (
        <form
          onSubmit={applyBulk}
          className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-emerald-50 px-4 py-3"
        >
          <span className="text-sm font-medium text-emerald-900">{selected.size} produto(s) selecionado(s)</span>
          <div>
            <label className="block text-xs font-medium text-slate-600">Nova classificação</label>
            <input
              required
              list="tipos-conhecidos"
              value={bulkForm.tipoProduto}
              onChange={(e) => setBulkForm({ tipoProduto: e.target.value })}
              className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={bulkSaving}
            className="rounded-md bg-emerald-700 px-4 py-1.5 text-sm text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            {bulkSaving ? 'Aplicando…' : `Aplicar a ${selected.size} produto(s)`}
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
      {bulkMsg && <p className="text-xs text-slate-600">{bulkMsg}</p>}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <span className="font-medium">Produtos cadastrados ({filteredProductTypes.length})</span>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="filtrar código, nome, classificação…"
              className="w-72 rounded-md border border-slate-300 px-2 py-1 text-sm"
            />
            <ExcelButtons
              exportFilename="produtos.xlsx"
              exportRows={() =>
                filteredProductTypes.map((p) => ({
                  Código: p.codigoPrd,
                  'Nome (ERP)': p.produtoNome ?? '',
                  Classificação: p.tipoProduto,
                }))
              }
              onImport={importProducts}
            />
          </div>
        </div>
        <p className="border-b border-slate-100 px-4 py-2 text-[11px] text-slate-500">
          Importação espera as colunas <strong>Código</strong>, <strong>Nome (ERP)</strong> e{' '}
          <strong>Classificação</strong>. Código já cadastrado é atualizado; código novo é criado.
        </p>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              <th className="px-3 py-2">
                <input
                  type="checkbox"
                  checked={filteredProductTypes.length > 0 && filteredProductTypes.every((p) => selected.has(p.codigoPrd))}
                  onChange={() =>
                    setSelected((prev) => {
                      const allSelected = filteredProductTypes.every((p) => prev.has(p.codigoPrd))
                      const next = new Set(prev)
                      for (const p of filteredProductTypes) {
                        if (allSelected) next.delete(p.codigoPrd)
                        else next.add(p.codigoPrd)
                      }
                      return next
                    })
                  }
                  className="h-3.5 w-3.5"
                />
              </th>
              <th className="px-3 py-2">Código</th>
              <th className="px-3 py-2">Nome (ERP)</th>
              <th className="px-3 py-2">Classificação</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {filteredProductTypes.map((p) => (
              <tr key={p.id} className="border-t border-slate-100">
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selected.has(p.codigoPrd)}
                    onChange={() => toggleSelected(p.codigoPrd)}
                    className="h-3.5 w-3.5"
                  />
                </td>
                <td className="px-3 py-2 font-mono text-xs">{p.codigoPrd}</td>
                <td className="px-3 py-2">{p.produtoNome ?? '—'}</td>
                <td className="px-3 py-2 font-medium">{p.tipoProduto}</td>
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
            {productTypes.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">
                  Nenhum produto classificado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
