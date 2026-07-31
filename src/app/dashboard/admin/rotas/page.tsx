'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ExcelButtons } from '@/components/admin/ExcelButtons'

interface Location {
  id: string
  name: string
  type: 'UNIDADE' | 'CLIENTE'
}

interface Route {
  id: string
  originId: string
  destinationId: string
  origin: Location
  destination: Location
  distanceAsphaltKm: string
  distanceDirtKm: string
  speedLoadedKmh: string | null
  speedEmptyKmh: string | null
  loadMinutes: number | null
  unloadMinutes: number | null
  expectedRoundTripDays: string | null
  fixedComposition: string | null
  active: boolean
}

interface CompositionSpecOption {
  composition: string
}

const EMPTY = {
  originId: '',
  destinationId: '',
  distanceAsphaltKm: '',
  distanceDirtKm: '',
  speedLoadedKmh: '',
  speedEmptyKmh: '',
  loadMinutes: '',
  unloadMinutes: '',
  expectedRoundTripDays: '',
  fixedComposition: '',
}
const BULK_EMPTY = { fixedComposition: '' }

function num(v: string | null): number {
  return v ? Number(v) : 0
}

export default function RotasPage() {
  const [routes, setRoutes] = useState<Route[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [compositionSpecs, setCompositionSpecs] = useState<CompositionSpecOption[]>([])
  const [form, setForm] = useState(EMPTY)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState('')

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkForm, setBulkForm] = useState(BULK_EMPTY)
  const [bulkSaving, setBulkSaving] = useState(false)
  const [bulkMsg, setBulkMsg] = useState('')

  const filteredRoutes = useMemo(() => {
    const f = filter.trim().toUpperCase()
    if (!f) return routes
    return routes.filter((r) =>
      [r.origin.name, r.destination.name, r.fixedComposition]
        .filter(Boolean)
        .some((v) => String(v).toUpperCase().includes(f)),
    )
  }, [routes, filter])

  const load = useCallback(async () => {
    const [r, l, c] = await Promise.all([
      fetch('/api/admin/routes'),
      fetch('/api/admin/locations'),
      fetch('/api/admin/composition-specs'),
    ])
    if (r.ok) setRoutes(await r.json())
    if (l.ok) setLocations(await l.json())
    if (c.ok) setCompositionSpecs(await c.json())
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  function startEdit(r: Route) {
    setEditingId(r.id)
    setForm({
      originId: r.originId,
      destinationId: r.destinationId,
      distanceAsphaltKm: String(Number(r.distanceAsphaltKm)),
      distanceDirtKm: String(Number(r.distanceDirtKm)),
      speedLoadedKmh: r.speedLoadedKmh ? String(Number(r.speedLoadedKmh)) : '',
      speedEmptyKmh: r.speedEmptyKmh ? String(Number(r.speedEmptyKmh)) : '',
      loadMinutes: r.loadMinutes?.toString() ?? '',
      unloadMinutes: r.unloadMinutes?.toString() ?? '',
      expectedRoundTripDays: r.expectedRoundTripDays ? String(Number(r.expectedRoundTripDays)) : '',
      fixedComposition: r.fixedComposition ?? '',
    })
    setError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const payload = {
      originId: form.originId,
      destinationId: form.destinationId,
      distanceAsphaltKm: Number(form.distanceAsphaltKm || 0),
      distanceDirtKm: Number(form.distanceDirtKm || 0),
      speedLoadedKmh: form.speedLoadedKmh === '' ? null : Number(form.speedLoadedKmh),
      speedEmptyKmh: form.speedEmptyKmh === '' ? null : Number(form.speedEmptyKmh),
      loadMinutes: form.loadMinutes === '' ? null : Number(form.loadMinutes),
      unloadMinutes: form.unloadMinutes === '' ? null : Number(form.unloadMinutes),
      expectedRoundTripDays:
        form.expectedRoundTripDays === '' ? null : Number(form.expectedRoundTripDays.replace(',', '.')),
      fixedComposition: form.fixedComposition === '' ? null : form.fixedComposition,
    }
    const res = await fetch(editingId ? `/api/admin/routes/${editingId}` : '/api/admin/routes', {
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
    if (!confirm('Excluir esta rota?')) return
    const res = await fetch(`/api/admin/routes/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Falha ao excluir')
      return
    }
    load()
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function applyBulk(e: React.FormEvent) {
    e.preventDefault()
    if (selected.size === 0) return
    setBulkSaving(true)
    setBulkMsg('')
    const fixedComposition = bulkForm.fixedComposition === '' ? null : bulkForm.fixedComposition
    const errors: string[] = []
    let ok = 0
    for (const id of selected) {
      const res = await fetch(`/api/admin/routes/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fixedComposition }),
      })
      if (res.ok) ok++
      else {
        const body = await res.json().catch(() => ({}))
        const r = routes.find((x) => x.id === id)
        errors.push(`${r ? `${r.origin.name} → ${r.destination.name}` : id}: ${body.error ?? 'falha'}`)
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

  async function importRoutes(rows: Record<string, string>[]): Promise<string> {
    let created = 0
    let updated = 0
    let skipped = 0
    const errors: string[] = []
    let snapshot = routes
    for (const row of rows) {
      const origemNome = String(row['Origem'] ?? '').trim()
      const destinoNome = String(row['Destino'] ?? '').trim()
      const origin = locations.find((l) => l.name.toUpperCase() === origemNome.toUpperCase())
      const destination = locations.find((l) => l.name.toUpperCase() === destinoNome.toUpperCase())
      if (!origin || !destination) {
        errors.push(`${origemNome} → ${destinoNome}: origem/destino não encontrado nos Locais`)
        continue
      }
      const asfalto = String(row['Asfalto (km)'] ?? '').trim()
      const terra = String(row['Terra (km)'] ?? '').trim()
      const vCheio = String(row['Velocidade cheio (km/h)'] ?? '').trim()
      const vVazio = String(row['Velocidade vazio (km/h)'] ?? '').trim()
      const carga = String(row['Carga (min)'] ?? '').trim()
      const descarga = String(row['Descarga (min)'] ?? '').trim()
      const idaVolta = String(row['Ida+volta (dias)'] ?? '').trim()
      const fixedComposition = String(row['Composição fixa'] ?? '').trim() || null
      if (!asfalto) {
        skipped++
        continue
      }
      const payload = {
        originId: origin.id,
        destinationId: destination.id,
        distanceAsphaltKm: Number(asfalto.replace(',', '.')) || 0,
        distanceDirtKm: terra === '' ? 0 : Number(terra.replace(',', '.')),
        speedLoadedKmh: vCheio === '' ? null : Number(vCheio.replace(',', '.')),
        speedEmptyKmh: vVazio === '' ? null : Number(vVazio.replace(',', '.')),
        loadMinutes: carga === '' ? null : Number(carga),
        unloadMinutes: descarga === '' ? null : Number(descarga),
        expectedRoundTripDays: idaVolta === '' ? null : Number(idaVolta.replace(',', '.')),
        fixedComposition,
      }
      const existing = snapshot.find(
        (r) => r.originId === origin.id && r.destinationId === destination.id,
      )
      const res = await fetch(existing ? `/api/admin/routes/${existing.id}` : '/api/admin/routes', {
        method: existing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        if (existing) updated++
        else created++
      } else {
        const body = await res.json().catch(() => ({}))
        errors.push(`${origemNome} → ${destinoNome}: ${body.error ?? 'falha ao salvar'}`)
      }
    }
    const res = await fetch('/api/admin/routes')
    if (res.ok) {
      snapshot = await res.json()
      setRoutes(snapshot)
    }
    const parts = [`${created} nova(s)`, `${updated} atualizada(s)`]
    if (skipped) parts.push(`${skipped} ignorada(s) (faltou asfalto)`)
    if (errors.length) parts.push(`erros: ${errors.slice(0, 3).join('; ')}${errors.length > 3 ? '…' : ''}`)
    return parts.join(', ')
  }

  const unidades = locations.filter((l) => l.type === 'UNIDADE')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Rotas</h1>
        <p className="text-sm text-slate-500">
          Origem (unidade) → destino, com distância por piso, velocidades cheio/vazio e tempos de
          carga/descarga — base para expectativa de viagem e retorno.
        </p>
      </div>

      <form onSubmit={save} className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-medium">{editingId ? 'Editar rota' : 'Nova rota'}</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div>
            <label className="block text-xs font-medium text-slate-600">Origem (unidade)</label>
            <select
              required
              value={form.originId}
              onChange={(e) => setForm({ ...form, originId: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="">Selecione…</option>
              {unidades.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Destino</label>
            <select
              required
              value={form.destinationId}
              onChange={(e) => setForm({ ...form, destinationId: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="">Selecione…</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} {l.type === 'UNIDADE' ? '(unidade)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Asfalto (km)</label>
            <input
              type="number" step="0.1" min="0" required
              value={form.distanceAsphaltKm}
              onChange={(e) => setForm({ ...form, distanceAsphaltKm: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Terra (km)</label>
            <input
              type="number" step="0.1" min="0"
              value={form.distanceDirtKm}
              onChange={(e) => setForm({ ...form, distanceDirtKm: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Velocidade cheio (km/h)</label>
            <input
              type="number" step="1" min="1"
              value={form.speedLoadedKmh}
              onChange={(e) => setForm({ ...form, speedLoadedKmh: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Velocidade vazio (km/h)</label>
            <input
              type="number" step="1" min="1"
              value={form.speedEmptyKmh}
              onChange={(e) => setForm({ ...form, speedEmptyKmh: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Carga (min)</label>
            <input
              type="number" step="1" min="0"
              value={form.loadMinutes}
              onChange={(e) => setForm({ ...form, loadMinutes: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Descarga (min)</label>
            <input
              type="number" step="1" min="0"
              value={form.unloadMinutes}
              onChange={(e) => setForm({ ...form, unloadMinutes: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">
              Expectativa ida+volta (dias)
            </label>
            <input
              type="number" step="0.5" min="0"
              value={form.expectedRoundTripDays}
              onChange={(e) => setForm({ ...form, expectedRoundTripDays: e.target.value })}
              placeholder="ex.: 2,5"
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
            <p className="mt-0.5 text-[11px] text-slate-500">Tem prioridade sobre o cálculo por velocidade</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">
              Composição fixa (opcional)
            </label>
            <select
              value={form.fixedComposition}
              onChange={(e) => setForm({ ...form, fixedComposition: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="">Nenhuma</option>
              {compositionSpecs.map((c) => (
                <option key={c.composition} value={c.composition}>{c.composition}</option>
              ))}
            </select>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Toda viagem nesta rota usa esta composição (tem prioridade sobre o cadastro de placa)
            </p>
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
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <span className="font-medium">Rotas cadastradas ({filteredRoutes.length})</span>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="filtrar origem, destino, composição…"
              className="w-72 rounded-md border border-slate-300 px-2 py-1 text-sm"
            />
            <ExcelButtons
              exportFilename="rotas.xlsx"
              exportRows={() =>
                filteredRoutes.map((r) => ({
                  Origem: r.origin.name,
                  Destino: r.destination.name,
                  'Asfalto (km)': num(r.distanceAsphaltKm),
                  'Terra (km)': num(r.distanceDirtKm),
                  'Velocidade cheio (km/h)': r.speedLoadedKmh ? num(r.speedLoadedKmh) : '',
                  'Velocidade vazio (km/h)': r.speedEmptyKmh ? num(r.speedEmptyKmh) : '',
                  'Carga (min)': r.loadMinutes ?? '',
                  'Descarga (min)': r.unloadMinutes ?? '',
                  'Ida+volta (dias)': r.expectedRoundTripDays ? Number(r.expectedRoundTripDays) : '',
                  'Composição fixa': r.fixedComposition ?? '',
                }))
              }
              onImport={importRoutes}
            />
          </div>
        </div>
        <p className="border-b border-slate-100 px-4 py-2 text-[11px] text-slate-500">
          Importação casa por <strong>Origem</strong>/<strong>Destino</strong> (nomes já cadastrados em
          Locais) — rota existente é atualizada, combinação nova é criada.
        </p>

        {selected.size > 0 && (
          <form
            onSubmit={applyBulk}
            className="flex flex-wrap items-end gap-2 border-b border-slate-100 bg-emerald-50 px-4 py-3"
          >
            <span className="text-sm font-medium text-emerald-900">{selected.size} rota(s) selecionada(s)</span>
            <div>
              <label className="block text-xs font-medium text-slate-600">Composição fixa</label>
              <select
                value={bulkForm.fixedComposition}
                onChange={(e) => setBulkForm({ fixedComposition: e.target.value })}
                className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              >
                <option value="">Nenhuma</option>
                {compositionSpecs.map((c) => (
                  <option key={c.composition} value={c.composition}>{c.composition}</option>
                ))}
              </select>
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

        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              <th className="px-3 py-2">
                <input
                  type="checkbox"
                  checked={filteredRoutes.length > 0 && filteredRoutes.every((r) => selected.has(r.id))}
                  onChange={() =>
                    setSelected((prev) => {
                      const allSelected = filteredRoutes.every((r) => prev.has(r.id))
                      const next = new Set(prev)
                      for (const r of filteredRoutes) {
                        if (allSelected) next.delete(r.id)
                        else next.add(r.id)
                      }
                      return next
                    })
                  }
                  className="h-3.5 w-3.5"
                />
              </th>
              <th className="px-3 py-2">Origem</th>
              <th className="px-3 py-2">Destino</th>
              <th className="px-3 py-2 text-right">Asfalto</th>
              <th className="px-3 py-2 text-right">Terra</th>
              <th className="px-3 py-2 text-right">Total (km)</th>
              <th className="px-3 py-2 text-right">V. cheio</th>
              <th className="px-3 py-2 text-right">V. vazio</th>
              <th className="px-3 py-2 text-right">Carga</th>
              <th className="px-3 py-2 text-right">Descarga</th>
              <th className="px-3 py-2 text-right">Ida+volta (dias)</th>
              <th className="px-3 py-2">Composição fixa</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {filteredRoutes.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selected.has(r.id)}
                    onChange={() => toggleSelected(r.id)}
                    className="h-3.5 w-3.5"
                  />
                </td>
                <td className="px-3 py-2 font-medium">{r.origin.name}</td>
                <td className="px-3 py-2">{r.destination.name}</td>
                <td className="px-3 py-2 text-right">{num(r.distanceAsphaltKm)}</td>
                <td className="px-3 py-2 text-right">{num(r.distanceDirtKm)}</td>
                <td className="px-3 py-2 text-right font-medium">
                  {num(r.distanceAsphaltKm) + num(r.distanceDirtKm)}
                </td>
                <td className="px-3 py-2 text-right">{r.speedLoadedKmh ? num(r.speedLoadedKmh) : '—'}</td>
                <td className="px-3 py-2 text-right">{r.speedEmptyKmh ? num(r.speedEmptyKmh) : '—'}</td>
                <td className="px-3 py-2 text-right">{r.loadMinutes ?? '—'}</td>
                <td className="px-3 py-2 text-right">{r.unloadMinutes ?? '—'}</td>
                <td className="px-3 py-2 text-right font-medium">
                  {r.expectedRoundTripDays
                    ? Number(r.expectedRoundTripDays).toLocaleString('pt-BR')
                    : '—'}
                </td>
                <td className="px-3 py-2">{r.fixedComposition ?? '—'}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <button onClick={() => startEdit(r)} className="text-emerald-700 hover:underline">
                    Editar
                  </button>
                  <button onClick={() => remove(r.id)} className="ml-3 text-red-600 hover:underline">
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
