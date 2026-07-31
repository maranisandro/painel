'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ExcelButtons } from '@/components/admin/ExcelButtons'

type Unidade = 'KM' | 'TONELADA' | 'MDC' | 'M3'

interface RouteOption {
  id: string
  origin: { name: string }
  destination: { name: string }
}

interface PriceRecord {
  id: string
  routeId: string
  valorReferencia: string
  unidade: Unidade
  effectiveFrom: string | null
  route: RouteOption
}

const UNIDADES: { value: Unidade; label: string }[] = [
  { value: 'KM', label: 'R$/km' },
  { value: 'TONELADA', label: 'R$/tonelada' },
  { value: 'MDC', label: 'R$/MDC' },
  { value: 'M3', label: 'R$/m³' },
]

function unidadeLabel(u: Unidade): string {
  return UNIDADES.find((o) => o.value === u)?.label ?? u
}

const EMPTY = { routeId: '', valorReferencia: '', unidade: 'TONELADA' as Unidade, effectiveFrom: '' }
const BULK_EMPTY = { valorReferencia: '', unidade: 'TONELADA' as Unidade, effectiveFrom: '' }

function fmtDate(iso: string | null): string {
  if (!iso) return 'cadastro'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

function parseImportDate(raw: string): { ok: true; value: string | null } | { ok: false } {
  const v = raw.trim()
  if (!v) return { ok: true, value: null }
  const br = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (br) return { ok: true, value: `${br[3]}-${br[2]}-${br[1]}` }
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return { ok: true, value: v.slice(0, 10) }
  return { ok: false }
}

function parseUnidade(raw: string): Unidade | null {
  const v = raw.trim().toUpperCase()
  if (v === 'KM' || v === 'TONELADA' || v === 'MDC' || v === 'M3' || v === 'M³') return v === 'M³' ? 'M3' : v
  return null
}

function routeLabel(r: RouteOption): string {
  return `${r.origin.name} → ${r.destination.name}`
}

export default function PrecosFretePage() {
  const [records, setRecords] = useState<PriceRecord[]>([])
  const [routes, setRoutes] = useState<RouteOption[]>([])
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
    const [pricesRes, routesRes] = await Promise.all([
      fetch('/api/admin/route-freight-prices'),
      fetch('/api/admin/routes'),
    ])
    if (pricesRes.ok) setRecords(await pricesRes.json())
    if (routesRes.ok) setRoutes(await routesRes.json())
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const byRoute = useMemo(() => {
    const map = new Map<string, PriceRecord[]>()
    for (const r of records) {
      const label = routeLabel(r.route)
      if (filter && !label.toUpperCase().includes(filter.toUpperCase())) continue
      const list = map.get(r.routeId) ?? []
      list.push(r)
      map.set(r.routeId, list)
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.effectiveFrom ?? '').localeCompare(b.effectiveFrom ?? ''))
    }
    return [...map.entries()].sort(([, a], [, b]) => routeLabel(a[0].route).localeCompare(routeLabel(b[0].route)))
  }, [records, filter])

  function toggleSelected(routeId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(routeId)) next.delete(routeId)
      else next.add(routeId)
      return next
    })
  }

  function startEdit(r: PriceRecord) {
    setEditingId(r.id)
    setForm({
      routeId: r.routeId,
      valorReferencia: String(Number(r.valorReferencia)),
      unidade: r.unidade,
      effectiveFrom: r.effectiveFrom ? r.effectiveFrom.slice(0, 10) : '',
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
          valorReferencia: Number(form.valorReferencia.replace(',', '.')),
          unidade: form.unidade,
          effectiveFrom: form.effectiveFrom === '' ? null : form.effectiveFrom,
        }
      : {
          routeId: form.routeId,
          valorReferencia: Number(form.valorReferencia.replace(',', '.')),
          unidade: form.unidade,
          effectiveFrom: form.effectiveFrom === '' ? null : form.effectiveFrom,
        }
    const res = await fetch(
      editingId ? `/api/admin/route-freight-prices/${editingId}` : '/api/admin/route-freight-prices',
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
    if (!confirm('Excluir este valor de referência?')) return
    const res = await fetch(`/api/admin/route-freight-prices/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Falha ao excluir')
      return
    }
    load()
  }

  // Cria (se não existir) ou atualiza (se existir) o valor de referência de uma rota para uma
  // data-alvo (null = cadastro). Usado no bulk-edit e na importação.
  async function upsertRoutePrice(
    routeId: string,
    valorReferencia: number,
    unidade: Unidade,
    effectiveFrom: string | null,
    currentRecords: PriceRecord[],
  ): Promise<{ ok: boolean; created: boolean; error?: string }> {
    const existing = currentRecords.find(
      (r) => r.routeId === routeId && (effectiveFrom ? r.effectiveFrom?.slice(0, 10) === effectiveFrom : r.effectiveFrom === null),
    )
    const payload = existing
      ? { valorReferencia, unidade, effectiveFrom }
      : { routeId, valorReferencia, unidade, effectiveFrom }
    const res = await fetch(existing ? `/api/admin/route-freight-prices/${existing.id}` : '/api/admin/route-freight-prices', {
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
    if (selected.size === 0 || !bulkForm.valorReferencia) return
    setBulkSaving(true)
    setBulkMsg('')
    const valor = Number(bulkForm.valorReferencia.replace(',', '.'))
    const effectiveFrom = bulkForm.effectiveFrom === '' ? null : bulkForm.effectiveFrom
    const errors: string[] = []
    let ok = 0
    for (const routeId of selected) {
      const result = await upsertRoutePrice(routeId, valor, bulkForm.unidade, effectiveFrom, records)
      if (result.ok) ok++
      else {
        const label = routes.find((r) => r.id === routeId)
        errors.push(`${label ? routeLabel(label) : routeId}: ${result.error}`)
      }
    }
    setBulkSaving(false)
    setSelected(new Set())
    setBulkForm(BULK_EMPTY)
    await load()
    setBulkMsg(
      errors.length
        ? `${ok} aplicada(s), ${errors.length} com erro: ${errors.slice(0, 3).join('; ')}${errors.length > 3 ? '…' : ''}`
        : `${ok} rota(s) atualizada(s).`,
    )
  }

  async function importPrices(rows: Record<string, string>[]): Promise<string> {
    let created = 0
    let updated = 0
    let skipped = 0
    const errors: string[] = []
    let snapshot = records
    for (const row of rows) {
      const rotaLabel = String(row['Rota'] ?? '').trim()
      const valorRaw = String(row['Valor'] ?? '').trim()
      const unidadeRaw = String(row['Unidade'] ?? '').trim()
      const dataRaw = String(row['Data da mudança'] ?? row['Data'] ?? '').trim()
      const route = routes.find((r) => routeLabel(r).toUpperCase() === rotaLabel.toUpperCase())
      if (!route || !valorRaw) {
        skipped++
        continue
      }
      const unidade = parseUnidade(unidadeRaw)
      if (!unidade) {
        errors.push(`${rotaLabel}: unidade inválida "${unidadeRaw}" (use KM, TONELADA, MDC ou M3)`)
        continue
      }
      const parsedDate = parseImportDate(dataRaw)
      if (!parsedDate.ok) {
        errors.push(`${rotaLabel}: data inválida "${dataRaw}" (use dd/mm/yyyy)`)
        continue
      }
      const valor = Number(valorRaw.replace(',', '.'))
      if (Number.isNaN(valor)) {
        errors.push(`${rotaLabel}: valor inválido "${valorRaw}"`)
        continue
      }
      const result = await upsertRoutePrice(route.id, valor, unidade, parsedDate.value, snapshot)
      if (result.ok) {
        if (result.created) created++
        else updated++
      } else {
        errors.push(`${rotaLabel}: ${result.error}`)
      }
    }
    const res = await fetch('/api/admin/route-freight-prices')
    if (res.ok) {
      snapshot = await res.json()
      setRecords(snapshot)
    }
    const parts = [`${created} nova(s)`, `${updated} atualizada(s)`]
    if (skipped) parts.push(`${skipped} ignorada(s) (rota não encontrada ou sem valor)`)
    if (errors.length) parts.push(`erros: ${errors.slice(0, 3).join('; ')}${errors.length > 3 ? '…' : ''}`)
    return parts.join(', ')
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Preços de frete por rota</h1>
        <p className="text-sm text-slate-500">
          Valor de referência por rota (R$ por km, tonelada, MDC ou m³, conforme a unidade do
          produto daquela rota), com histórico por data — o valor de cadastro vale até a primeira
          mudança; cada mudança vale a partir da data dela. O painel usa esse valor (nunca a nota
          fiscal, que mistura frete e produto) para calcular a receita esperada de frete, comparada
          com o custo do mês.
        </p>
      </div>

      <form onSubmit={save} className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-medium">
          {editingId ? 'Editar valor' : 'Novo valor de referência / mudança'}
        </h2>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <div>
            <label className="block text-xs font-medium text-slate-600">Rota</label>
            <select
              required
              disabled={!!editingId}
              value={form.routeId}
              onChange={(e) => setForm({ ...form, routeId: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-100"
            >
              <option value="">Selecione…</option>
              {routes.map((r) => (
                <option key={r.id} value={r.id}>{routeLabel(r)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Unidade</label>
            <select
              value={form.unidade}
              onChange={(e) => setForm({ ...form, unidade: e.target.value as Unidade })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            >
              {UNIDADES.map((u) => (
                <option key={u.value} value={u.value}>{u.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Valor</label>
            <input
              required
              type="number" step="0.01" min="0"
              value={form.valorReferencia}
              onChange={(e) => setForm({ ...form, valorReferencia: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">
              Data da mudança (vazio = cadastro)
            </label>
            <input
              type="date"
              value={form.effectiveFrom}
              onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div className="flex items-end gap-2">
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
        </div>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </form>

      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <span className="font-medium">Rotas com valor cadastrado ({byRoute.length})</span>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="filtrar rota…"
              className="rounded-md border border-slate-300 px-2 py-1 text-sm"
            />
            <ExcelButtons
              exportFilename="precos-frete.xlsx"
              exportRows={() =>
                byRoute.flatMap(([, list]) =>
                  list.map((r) => ({
                    Rota: routeLabel(r.route),
                    Unidade: r.unidade,
                    Valor: Number(r.valorReferencia),
                    'Data da mudança': r.effectiveFrom ? fmtDate(r.effectiveFrom) : '',
                  })),
                )
              }
              onImport={importPrices}
            />
          </div>
        </div>
        <p className="border-b border-slate-100 px-4 py-2 text-[11px] text-slate-500">
          Importação espera as colunas <strong>Rota</strong> (igual ao rótulo “origem → destino”),{' '}
          <strong>Unidade</strong> (KM, TONELADA, MDC ou M3), <strong>Valor</strong> e{' '}
          <strong>Data da mudança</strong> (dd/mm/yyyy, vazio = cadastro).
        </p>

        {selected.size > 0 && (
          <form
            onSubmit={applyBulk}
            className="flex flex-wrap items-end gap-2 border-b border-slate-100 bg-emerald-50 px-4 py-3"
          >
            <span className="text-sm font-medium text-emerald-900">{selected.size} rota(s) selecionada(s)</span>
            <div>
              <label className="block text-xs font-medium text-slate-600">Unidade</label>
              <select
                value={bulkForm.unidade}
                onChange={(e) => setBulkForm({ ...bulkForm, unidade: e.target.value as Unidade })}
                className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              >
                {UNIDADES.map((u) => (
                  <option key={u.value} value={u.value}>{u.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600">Novo valor</label>
              <input
                required
                type="number" step="0.01" min="0"
                value={bulkForm.valorReferencia}
                onChange={(e) => setBulkForm({ ...bulkForm, valorReferencia: e.target.value })}
                className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600">Data (vazio = cadastro)</label>
              <input
                type="date"
                value={bulkForm.effectiveFrom}
                onChange={(e) => setBulkForm({ ...bulkForm, effectiveFrom: e.target.value })}
                className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={bulkSaving}
              className="rounded-md bg-emerald-700 px-4 py-1.5 text-sm text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              {bulkSaving ? 'Aplicando…' : `Aplicar a ${selected.size} rota(s)`}
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
          {byRoute.map(([routeId, list]) => (
            <div key={routeId} className="flex flex-wrap items-center gap-2 px-4 py-2">
              <input
                type="checkbox"
                checked={selected.has(routeId)}
                onChange={() => toggleSelected(routeId)}
                className="h-3.5 w-3.5 shrink-0"
              />
              <span className="w-56 shrink-0 text-sm font-medium">{routeLabel(list[0].route)}</span>
              <div className="flex flex-wrap items-center gap-1 text-sm">
                {list.map((r, i) => (
                  <span key={r.id} className="flex items-center gap-1">
                    {i > 0 && <span className="text-slate-400">→</span>}
                    <span
                      className={`rounded px-2 py-0.5 ${r.effectiveFrom ? 'bg-cyan-50 text-cyan-900' : 'bg-slate-100 text-slate-700'}`}
                    >
                      R$ {Number(r.valorReferencia).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}{' '}
                      <span className="text-xs font-medium">{unidadeLabel(r.unidade)}</span>
                      <span className="ml-1 text-xs text-slate-500">({fmtDate(r.effectiveFrom)})</span>
                    </span>
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
          {byRoute.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-slate-500">
              Nenhum valor de referência cadastrado.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
