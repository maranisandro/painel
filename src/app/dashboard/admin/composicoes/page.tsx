'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { ExcelButtons } from '@/components/admin/ExcelButtons'
import { formatBRInput, parseBRToIso, fmtDateBR, MiniCalendarButton } from '@/components/shared/DateRangeInputs'

interface CompositionRecord {
  id: string
  placa: string
  composition: string
  effectiveFrom: string | null
  createdAt: string
}

interface CompositionSpecRecord {
  id: string
  composition: string
  numEixos: string | null
  pbtcMaximoTon: string | null
  taraMinTon: string | null
  taraMaxTon: string | null
  cargaLiquidaMinTon: string | null
  cargaLiquidaMaxTon: string | null
}

const SPEC_EMPTY = {
  composition: '',
  numEixos: '',
  pbtcMaximoTon: '',
  taraMinTon: '',
  taraMaxTon: '',
  cargaLiquidaMinTon: '',
  cargaLiquidaMaxTon: '',
}

function n(v: string | null): string {
  return v ? Number(v).toLocaleString('pt-BR') : '—'
}

const COMPOSITIONS = [
  'Rodo Caçamba',
  'RodoTrem',
  'LS 4 Eixos',
  'LS 3 Eixos',
  'BiTrem',
  'Tritrem Florestal',
  'Romeu e Julieta',
  'Outros',
]

const EMPTY = { placa: '', composition: '', effectiveFrom: '' }
const BULK_EMPTY = { composition: '', effectiveFrom: '' }

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
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

const TABS = [
  { key: 'placas', label: 'Composições por placa' },
  { key: 'limites', label: 'Limites de peso' },
] as const
type TabKey = (typeof TABS)[number]['key']

export default function ComposicoesPage() {
  // Chegando via link externo com ?placa=XXX (pedido do usuário 2026-08-12:
  // botão "ver composição" no balão do mapa de Rastreamento) já abre direto
  // na aba de placas filtrada pela placa clicada.
  const searchParams = useSearchParams()
  const placaInicial = searchParams.get('placa') ?? ''
  const [tab, setTab] = useState<TabKey>('placas')

  const [records, setRecords] = useState<CompositionRecord[]>([])
  const [form, setForm] = useState(EMPTY)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [placaFilter, setPlacaFilter] = useState(placaInicial)
  const [compositionFilter, setCompositionFilter] = useState('')

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkForm, setBulkForm] = useState(BULK_EMPTY)
  const [bulkSaving, setBulkSaving] = useState(false)
  const [bulkMsg, setBulkMsg] = useState('')

  // Máscara dd/mm/aaaa pro campo de data — o input nativo type="date" segue
  // o locale do navegador/SO (pode exibir mm/dd/aaaa mesmo com <html
  // lang="pt-BR">), achado real 2026-08-20: "no cadastro de composição a
  // data não esta dd/mm/aaaa". Mesmo padrão já usado em DateRangeInputs.
  const [effectiveFromText, setEffectiveFromText] = useState('')
  const [bulkEffectiveFromText, setBulkEffectiveFromText] = useState('')
  useEffect(() => setEffectiveFromText(form.effectiveFrom ? fmtDateBR(form.effectiveFrom) : ''), [form.effectiveFrom])
  useEffect(() => setBulkEffectiveFromText(bulkForm.effectiveFrom ? fmtDateBR(bulkForm.effectiveFrom) : ''), [bulkForm.effectiveFrom])

  const [specs, setSpecs] = useState<CompositionSpecRecord[]>([])
  const [specForm, setSpecForm] = useState(SPEC_EMPTY)
  const [specEditingId, setSpecEditingId] = useState<string | null>(null)
  const [specError, setSpecError] = useState('')
  const [specSaving, setSpecSaving] = useState(false)
  const [specFilter, setSpecFilter] = useState('')

  const filteredSpecs = useMemo(() => {
    const f = specFilter.trim().toUpperCase()
    if (!f) return specs
    return specs.filter((s) => [s.composition, s.numEixos].filter(Boolean).some((v) => String(v).toUpperCase().includes(f)))
  }, [specs, specFilter])

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/compositions')
    if (res.ok) setRecords(await res.json())
  }, [])

  const loadSpecs = useCallback(async () => {
    const res = await fetch('/api/admin/composition-specs')
    if (res.ok) setSpecs(await res.json())
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load()
      void loadSpecs()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [load, loadSpecs])

  // Agrupa por placa: cadastro primeiro, mudanças em ordem de data
  const byPlaca = useMemo(() => {
    const map = new Map<string, CompositionRecord[]>()
    for (const r of records) {
      if (placaFilter && !r.placa.toUpperCase().includes(placaFilter.toUpperCase())) continue
      const list = map.get(r.placa) ?? []
      list.push(r)
      map.set(r.placa, list)
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.effectiveFrom ?? '').localeCompare(b.effectiveFrom ?? ''))
    }
    let entries = [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
    if (compositionFilter) {
      entries = entries.filter(([, list]) => list.some((r) => r.composition === compositionFilter))
    }
    return entries
  }, [records, placaFilter, compositionFilter])

  function toggleSelected(placa: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(placa)) next.delete(placa)
      else next.add(placa)
      return next
    })
  }

  function toggleSelectAll() {
    setSelected((prev) => (prev.size === byPlaca.length ? new Set() : new Set(byPlaca.map(([placa]) => placa))))
  }

  function startEdit(r: CompositionRecord) {
    setEditingId(r.id)
    setForm({
      placa: r.placa,
      composition: r.composition,
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
          composition: form.composition,
          effectiveFrom: form.effectiveFrom === '' ? null : form.effectiveFrom,
        }
      : {
          placa: form.placa,
          composition: form.composition,
          effectiveFrom: form.effectiveFrom === '' ? null : form.effectiveFrom,
        }
    const res = await fetch(
      editingId ? `/api/admin/compositions/${editingId}` : '/api/admin/compositions',
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
    if (!confirm('Excluir este registro de composição?')) return
    const res = await fetch(`/api/admin/compositions/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Falha ao excluir')
      return
    }
    load()
  }

  // Cria (se não existir) ou atualiza (se existir) o registro de uma placa para uma
  // determinada data-alvo (null = composição de cadastro). Usado no bulk-edit e na importação.
  async function upsertPlacaComposition(
    placa: string,
    composition: string,
    effectiveFrom: string | null,
    currentRecords: CompositionRecord[],
  ): Promise<{ ok: boolean; created: boolean; error?: string }> {
    const existing = currentRecords.find(
      (r) => r.placa === placa && (effectiveFrom ? r.effectiveFrom?.slice(0, 10) === effectiveFrom : r.effectiveFrom === null),
    )
    const payload = existing
      ? { composition, effectiveFrom }
      : { placa, composition, effectiveFrom }
    const res = await fetch(existing ? `/api/admin/compositions/${existing.id}` : '/api/admin/compositions', {
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
    if (selected.size === 0 || !bulkForm.composition) return
    setBulkSaving(true)
    setBulkMsg('')
    const effectiveFrom = bulkForm.effectiveFrom === '' ? null : bulkForm.effectiveFrom
    const errors: string[] = []
    let ok = 0
    for (const placa of selected) {
      const result = await upsertPlacaComposition(placa, bulkForm.composition, effectiveFrom, records)
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
        : `${ok} placa(s) atualizada(s).`,
    )
  }

  async function importPlacas(rows: Record<string, string>[]): Promise<string> {
    let created = 0
    let updated = 0
    let skipped = 0
    const errors: string[] = []
    let snapshot = records
    for (const row of rows) {
      const placa = String(row['Placa'] ?? '').trim().toUpperCase()
      const composition = String(row['Composição'] ?? row['Composicao'] ?? '').trim()
      const dataRaw = String(row['Data da mudança'] ?? row['Data'] ?? '').trim()
      if (!placa || !composition) {
        skipped++
        continue
      }
      const parsedDate = parseImportDate(dataRaw)
      if (!parsedDate.ok) {
        errors.push(`${placa}: data inválida "${dataRaw}" (use dd/mm/yyyy)`)
        continue
      }
      const result = await upsertPlacaComposition(placa, composition, parsedDate.value, snapshot)
      if (result.ok) {
        if (result.created) created++
        else updated++
      } else {
        errors.push(`${placa}: ${result.error}`)
      }
    }
    const res = await fetch('/api/admin/compositions')
    if (res.ok) {
      snapshot = await res.json()
      setRecords(snapshot)
    }
    const parts = [`${created} nova(s)`, `${updated} atualizada(s)`]
    if (skipped) parts.push(`${skipped} ignorada(s) (faltou placa/composição)`)
    if (errors.length) parts.push(`erros: ${errors.slice(0, 3).join('; ')}${errors.length > 3 ? '…' : ''}`)
    return parts.join(', ')
  }

  function startEditSpec(s: CompositionSpecRecord) {
    setSpecEditingId(s.id)
    setSpecForm({
      composition: s.composition,
      numEixos: s.numEixos ?? '',
      pbtcMaximoTon: s.pbtcMaximoTon ? String(Number(s.pbtcMaximoTon)) : '',
      taraMinTon: s.taraMinTon ? String(Number(s.taraMinTon)) : '',
      taraMaxTon: s.taraMaxTon ? String(Number(s.taraMaxTon)) : '',
      cargaLiquidaMinTon: s.cargaLiquidaMinTon ? String(Number(s.cargaLiquidaMinTon)) : '',
      cargaLiquidaMaxTon: s.cargaLiquidaMaxTon ? String(Number(s.cargaLiquidaMaxTon)) : '',
    })
    setSpecError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function saveSpec(e: React.FormEvent) {
    e.preventDefault()
    setSpecSaving(true)
    setSpecError('')
    const payload = {
      composition: specForm.composition,
      numEixos: specForm.numEixos === '' ? null : specForm.numEixos,
      pbtcMaximoTon: specForm.pbtcMaximoTon === '' ? null : Number(specForm.pbtcMaximoTon.replace(',', '.')),
      taraMinTon: specForm.taraMinTon === '' ? null : Number(specForm.taraMinTon.replace(',', '.')),
      taraMaxTon: specForm.taraMaxTon === '' ? null : Number(specForm.taraMaxTon.replace(',', '.')),
      cargaLiquidaMinTon: specForm.cargaLiquidaMinTon === '' ? null : Number(specForm.cargaLiquidaMinTon.replace(',', '.')),
      cargaLiquidaMaxTon: specForm.cargaLiquidaMaxTon === '' ? null : Number(specForm.cargaLiquidaMaxTon.replace(',', '.')),
    }
    const res = await fetch(
      specEditingId ? `/api/admin/composition-specs/${specEditingId}` : '/api/admin/composition-specs',
      {
        method: specEditingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    )
    setSpecSaving(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setSpecError(body.error ?? 'Falha ao salvar')
      return
    }
    setSpecForm(SPEC_EMPTY)
    setSpecEditingId(null)
    loadSpecs()
  }

  async function removeSpec(id: string) {
    if (!confirm('Excluir este limite de peso?')) return
    const res = await fetch(`/api/admin/composition-specs/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setSpecError(body.error ?? 'Falha ao excluir')
      return
    }
    loadSpecs()
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Composições</h1>
        <p className="text-sm text-slate-500">
          O implemento de cadastro vale até a primeira mudança; cada mudança vale a partir da data
          dela. As viagens usam a composição vigente na data de saída.
        </p>
      </div>

      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-t-md px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.key
                ? 'border border-b-0 border-slate-200 bg-emerald-700 text-white shadow-sm'
                : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'placas' && (
        <div className="space-y-4">
          <form onSubmit={save} className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="font-medium">
              {editingId ? 'Editar registro' : 'Nova composição / mudança de implemento'}
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
                <label className="block text-xs font-medium text-slate-600">Implemento</label>
                <select
                  required
                  value={form.composition}
                  onChange={(e) => setForm({ ...form, composition: e.target.value })}
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                >
                  <option value="">Selecione…</option>
                  {specs.map((s) => (
                    <option key={s.composition} value={s.composition}>{s.composition}</option>
                  ))}
                </select>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  Novo tipo? Cadastre primeiro na aba “Limites de peso”.
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600">
                  Data da mudança (vazio = cadastro)
                </label>
                <div className="mt-1 flex items-center gap-1">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={effectiveFromText}
                    onChange={(e) => {
                      const formatted = formatBRInput(e.target.value)
                      setEffectiveFromText(formatted)
                      if (formatted === '') {
                        setForm({ ...form, effectiveFrom: '' })
                        return
                      }
                      const iso = parseBRToIso(formatted)
                      if (iso) setForm({ ...form, effectiveFrom: iso })
                    }}
                    placeholder="dd/mm/aaaa"
                    maxLength={10}
                    className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  />
                  <MiniCalendarButton
                    valueIso={form.effectiveFrom}
                    onSelect={(iso) => {
                      setForm({ ...form, effectiveFrom: iso })
                      setEffectiveFromText(fmtDateBR(iso))
                    }}
                  />
                </div>
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
              <span className="font-medium">Placas cadastradas ({byPlaca.length})</span>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={placaFilter}
                  onChange={(e) => setPlacaFilter(e.target.value)}
                  placeholder="filtrar placa…"
                  className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                />
                <select
                  value={compositionFilter}
                  onChange={(e) => setCompositionFilter(e.target.value)}
                  className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                >
                  <option value="">Todas as composições</option>
                  {specs.map((s) => (
                    <option key={s.composition} value={s.composition}>{s.composition}</option>
                  ))}
                </select>
                <ExcelButtons
                  exportFilename="composicoes-por-placa.xlsx"
                  exportRows={() =>
                    byPlaca.flatMap(([placa, list]) =>
                      list.map((r) => ({
                        Placa: placa,
                        Composição: r.composition,
                        'Data da mudança': r.effectiveFrom ? fmtDate(r.effectiveFrom) : '',
                        'Vigente desde': r.effectiveFrom ? fmtDate(r.effectiveFrom) : fmtDate(r.createdAt),
                      })),
                    )
                  }
                  onImport={importPlacas}
                />
              </div>
            </div>
            <p className="border-b border-slate-100 px-4 py-2 text-[11px] text-slate-500">
              Importação espera as colunas <strong>Placa</strong>, <strong>Composição</strong> e{' '}
              <strong>Data da mudança</strong> (dd/mm/yyyy, vazio = composição de cadastro). Se já existir
              registro para a placa nessa data, ele é atualizado; caso contrário, é criado.
            </p>

            {selected.size > 0 && (
              <form
                onSubmit={applyBulk}
                className="flex flex-wrap items-end gap-2 border-b border-slate-100 bg-emerald-50 px-4 py-3"
              >
                <span className="text-sm font-medium text-emerald-900">
                  {selected.size} placa(s) selecionada(s)
                </span>
                <div>
                  <label className="block text-xs font-medium text-slate-600">Nova composição</label>
                  <select
                    required
                    value={bulkForm.composition}
                    onChange={(e) => setBulkForm({ ...bulkForm, composition: e.target.value })}
                    className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  >
                    <option value="">Selecione…</option>
                    {specs.map((s) => (
                      <option key={s.composition} value={s.composition}>{s.composition}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600">
                    Data (vazio = cadastro)
                  </label>
                  <div className="mt-1 flex items-center gap-1">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={bulkEffectiveFromText}
                      onChange={(e) => {
                        const formatted = formatBRInput(e.target.value)
                        setBulkEffectiveFromText(formatted)
                        if (formatted === '') {
                          setBulkForm({ ...bulkForm, effectiveFrom: '' })
                          return
                        }
                        const iso = parseBRToIso(formatted)
                        if (iso) setBulkForm({ ...bulkForm, effectiveFrom: iso })
                      }}
                      placeholder="dd/mm/aaaa"
                      maxLength={10}
                      className="w-28 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                    />
                    <MiniCalendarButton
                      valueIso={bulkForm.effectiveFrom}
                      onSelect={(iso) => {
                        setBulkForm({ ...bulkForm, effectiveFrom: iso })
                        setBulkEffectiveFromText(fmtDateBR(iso))
                      }}
                    />
                  </div>
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
              <div className="flex items-center gap-2 px-4 py-1.5 text-xs text-slate-400">
                <input
                  type="checkbox"
                  checked={byPlaca.length > 0 && selected.size === byPlaca.length}
                  onChange={toggleSelectAll}
                  className="h-3.5 w-3.5"
                />
                selecionar todas
              </div>
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
                    {list.map((r, i) => (
                      <span key={r.id} className="flex items-center gap-1">
                        {i > 0 && <span className="text-slate-400">→</span>}
                        <span
                          className={`rounded px-2 py-0.5 ${r.effectiveFrom ? 'bg-cyan-50 text-cyan-900' : 'bg-slate-100 text-slate-700'}`}
                        >
                          {r.composition}
                          <span className="ml-1 text-xs text-slate-500">
                            {r.effectiveFrom
                              ? `desde ${fmtDate(r.effectiveFrom)}`
                              : `cadastro (desde ${fmtDate(r.createdAt)})`}
                          </span>
                        </span>
                        <button
                          onClick={() => startEdit(r)}
                          className="text-xs text-emerald-700 hover:underline"
                        >
                          editar
                        </button>
                        <button
                          onClick={() => remove(r.id)}
                          className="text-xs text-red-600 hover:underline"
                        >
                          excluir
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
              {byPlaca.length === 0 && (
                <p className="px-4 py-8 text-center text-sm text-slate-500">
                  Nenhuma composição cadastrada.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'limites' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            Peso máximo por implemento, usado na conformidade de peso do painel: o peso líquido de
            uma viagem não pode superar a carga líquida máxima da composição vigente. Viagens com
            2+ notas fiscais agrupadas são sempre consideradas RodoTrem automaticamente.
          </p>

          <form onSubmit={saveSpec} className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="font-medium">{specEditingId ? 'Editar limite' : 'Novo limite de peso'}</h2>
            <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div>
                <label className="block text-xs font-medium text-slate-600">Composição (nome do novo tipo)</label>
                <input
                  required
                  list="composicoes-sugestoes"
                  disabled={!!specEditingId}
                  value={specForm.composition}
                  onChange={(e) => setSpecForm({ ...specForm, composition: e.target.value })}
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-100"
                />
                <datalist id="composicoes-sugestoes">
                  {COMPOSITIONS.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600">Nº de eixos</label>
                <input
                  value={specForm.numEixos}
                  onChange={(e) => setSpecForm({ ...specForm, numEixos: e.target.value })}
                  placeholder="ex.: 9 eixos"
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600">PBTC máximo (t)</label>
                <input
                  type="number" step="0.1" min="0"
                  value={specForm.pbtcMaximoTon}
                  onChange={(e) => setSpecForm({ ...specForm, pbtcMaximoTon: e.target.value })}
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600">Tara mín. (t)</label>
                <input
                  type="number" step="0.1" min="0"
                  value={specForm.taraMinTon}
                  onChange={(e) => setSpecForm({ ...specForm, taraMinTon: e.target.value })}
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600">Tara máx. (t)</label>
                <input
                  type="number" step="0.1" min="0"
                  value={specForm.taraMaxTon}
                  onChange={(e) => setSpecForm({ ...specForm, taraMaxTon: e.target.value })}
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600">Carga líquida mín. (t)</label>
                <input
                  type="number" step="0.1" min="0"
                  value={specForm.cargaLiquidaMinTon}
                  onChange={(e) => setSpecForm({ ...specForm, cargaLiquidaMinTon: e.target.value })}
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600">
                  Carga líquida máx. (t)
                </label>
                <input
                  type="number" step="0.1" min="0"
                  value={specForm.cargaLiquidaMaxTon}
                  onChange={(e) => setSpecForm({ ...specForm, cargaLiquidaMaxTon: e.target.value })}
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                />
                <p className="mt-0.5 text-[11px] text-slate-500">Teto usado na conformidade de peso</p>
              </div>
            </div>
            {specError && <p className="mt-2 text-sm text-red-600">{specError}</p>}
            <div className="mt-3 flex gap-2">
              <button
                type="submit"
                disabled={specSaving}
                className="rounded-md bg-emerald-700 px-4 py-1.5 text-sm text-white hover:bg-emerald-800 disabled:opacity-50"
              >
                {specSaving ? 'Salvando…' : specEditingId ? 'Salvar alterações' : 'Adicionar'}
              </button>
              {specEditingId && (
                <button
                  type="button"
                  onClick={() => {
                    setSpecEditingId(null)
                    setSpecForm(SPEC_EMPTY)
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
              <span className="font-medium">Limites cadastrados ({filteredSpecs.length})</span>
              <input
                value={specFilter}
                onChange={(e) => setSpecFilter(e.target.value)}
                placeholder="filtrar composição…"
                className="rounded-md border border-slate-300 px-2 py-1 text-sm"
              />
            </div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2">Composição</th>
                  <th className="px-3 py-2">Nº de eixos</th>
                  <th className="px-3 py-2 text-right">PBTC máx.</th>
                  <th className="px-3 py-2 text-right">Tara</th>
                  <th className="px-3 py-2 text-right">Carga líquida (limite)</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {filteredSpecs.map((s) => (
                  <tr key={s.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium">{s.composition}</td>
                    <td className="px-3 py-2">{s.numEixos ?? '—'}</td>
                    <td className="px-3 py-2 text-right">{n(s.pbtcMaximoTon)} t</td>
                    <td className="px-3 py-2 text-right">
                      {n(s.taraMinTon)}–{n(s.taraMaxTon)} t
                    </td>
                    <td className="px-3 py-2 text-right font-medium">
                      {n(s.cargaLiquidaMinTon)}–{n(s.cargaLiquidaMaxTon)} t
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button onClick={() => startEditSpec(s)} className="text-emerald-700 hover:underline">
                        Editar
                      </button>
                      <button onClick={() => removeSpec(s.id)} className="ml-3 text-red-600 hover:underline">
                        Excluir
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredSpecs.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">
                      Nenhum limite de peso cadastrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
