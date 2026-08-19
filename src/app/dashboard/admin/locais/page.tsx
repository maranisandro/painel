'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { ExcelButtons } from '@/components/admin/ExcelButtons'
import { LocationShapeMap } from '@/components/admin/LocationShapeMap'

type LocationType = 'UNIDADE' | 'CLIENTE' | 'CIDADE' | 'POSTO_GASOLINA' | 'OFICINA' | 'RESIDENCIA'

const TYPE_LABEL: Record<LocationType, string> = {
  UNIDADE: 'Unidade do grupo',
  CLIENTE: 'Cliente',
  CIDADE: 'Cidade',
  POSTO_GASOLINA: 'Posto de gasolina',
  OFICINA: 'Oficina',
  RESIDENCIA: 'Residência',
}
const TYPE_BADGE: Record<LocationType, string> = {
  UNIDADE: 'bg-emerald-100 text-emerald-800',
  CLIENTE: 'bg-cyan-100 text-cyan-800',
  CIDADE: 'bg-slate-100 text-slate-700',
  POSTO_GASOLINA: 'bg-yellow-100 text-yellow-800',
  OFICINA: 'bg-violet-100 text-violet-800',
  RESIDENCIA: 'bg-pink-100 text-pink-800',
}

interface Location {
  id: string
  name: string
  officialName: string | null
  type: LocationType
  matchColigada: number | null
  matchFilial: number | null
  matchClientePattern: string | null
  motoristaNome: string | null
  latitude: number | null
  longitude: number | null
  raioMetros: number | null
  polygon: { lat: number; lng: number }[] | null
  active: boolean
  _count?: { routesFrom: number; routesTo: number }
}

interface PendingUnit {
  coligada: number
  filial: number
  nomeReal: string
  viagens: number
}

interface PendingOficina {
  latitude: number
  longitude: number
  nPosicoes: number
  placas: string[]
  primeiraData: string
  ultimaData: string
  horasEstimadas: number
}

const EMPTY = {
  name: '',
  officialName: '',
  type: 'UNIDADE' as LocationType,
  matchColigada: '',
  matchFilial: '',
  matchClientePattern: '',
  motoristaNome: '',
  latitude: '',
  longitude: '',
  raioMetros: '',
  polygon: null as { lat: number; lng: number }[] | null,
}

export default function LocaisPage() {
  const [locations, setLocations] = useState<Location[]>([])
  const [pending, setPending] = useState<PendingUnit[]>([])
  const [pendingOficinas, setPendingOficinas] = useState<PendingOficina[]>([])
  const [form, setForm] = useState(EMPTY)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState('')

  const filteredLocations = useMemo(() => {
    const f = filter.trim().toUpperCase()
    if (!f) return locations
    return locations.filter((l) =>
      [l.name, l.officialName, l.matchClientePattern, l.type]
        .filter(Boolean)
        .some((v) => String(v).toUpperCase().includes(f)),
    )
  }, [locations, filter])

  const load = useCallback(async () => {
    const [res, pend, pendOficinas] = await Promise.all([
      fetch('/api/admin/locations'),
      fetch('/api/admin/locations/pending'),
      fetch('/api/admin/locations/pending-oficinas'),
    ])
    if (res.ok) setLocations(await res.json())
    if (pend.ok) setPending(await pend.json())
    if (pendOficinas.ok) setPendingOficinas(await pendOficinas.json())
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  function startEdit(l: Location) {
    setEditingId(l.id)
    setForm({
      name: l.name,
      officialName: l.officialName ?? '',
      type: l.type,
      matchColigada: l.matchColigada?.toString() ?? '',
      matchFilial: l.matchFilial?.toString() ?? '',
      matchClientePattern: l.matchClientePattern ?? '',
      motoristaNome: l.motoristaNome ?? '',
      latitude: l.latitude?.toString() ?? '',
      longitude: l.longitude?.toString() ?? '',
      raioMetros: l.raioMetros?.toString() ?? '',
      polygon: l.polygon ?? null,
    })
    setError('')
  }

  /** Pré-preenche o formulário a partir de uma unidade encontrada nos dados. */
  function startFromPending(p: PendingUnit) {
    setEditingId(null)
    setForm({
      name: '',
      officialName: p.nomeReal,
      type: 'UNIDADE',
      matchColigada: String(p.coligada),
      matchFilial: String(p.filial),
      matchClientePattern: '',
      motoristaNome: '',
      latitude: '',
      longitude: '',
      raioMetros: '',
      polygon: null,
    })
    setError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  /**
   * Pré-preenche o formulário a partir de uma coordenada avulsa (ex.: "ver no
   * mapa" na aba Pernoite do Rastreamento) — pedido do usuário 2026-08-19:
   * "não me deixa cadastrar o local, preciso desta opção". Tipo fica em
   * aberto (usuário escolhe depois de identificar visualmente no mapa o que
   * tem naquele ponto — diferente da Oficina, aqui não sabemos o tipo ainda).
   */
  function startFromCoordinate(lat: number, lng: number) {
    setEditingId(null)
    setForm({
      name: '',
      officialName: '',
      type: 'UNIDADE',
      matchColigada: '',
      matchFilial: '',
      matchClientePattern: '',
      motoristaNome: '',
      latitude: lat.toFixed(6),
      longitude: lng.toFixed(6),
      raioMetros: '300',
      polygon: null,
    })
    setError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Chega aqui via link "➕ cadastrar local" na aba Pernoite do Rastreamento
  // (RastreamentoFrota.tsx) — só faz sentido rodar uma vez, ao entrar na
  // página com os parâmetros na URL.
  const searchParams = useSearchParams()
  useEffect(() => {
    const lat = searchParams.get('lat')
    const lng = searchParams.get('lng')
    if (lat && lng) startFromCoordinate(Number(lat), Number(lng))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Pré-preenche o formulário a partir de um cluster de GPS candidato a Oficina. */
  function startFromPendingOficina(p: PendingOficina) {
    setEditingId(null)
    setForm({
      name: '',
      officialName: '',
      type: 'OFICINA',
      matchColigada: '',
      matchFilial: '',
      matchClientePattern: '',
      motoristaNome: '',
      latitude: p.latitude.toFixed(6),
      longitude: p.longitude.toFixed(6),
      raioMetros: '300',
      polygon: null,
    })
    setError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const payload = {
      name: form.name,
      officialName: form.officialName === '' ? null : form.officialName,
      type: form.type,
      matchColigada: form.matchColigada === '' ? null : Number(form.matchColigada),
      matchFilial: form.matchFilial === '' ? null : Number(form.matchFilial),
      matchClientePattern: form.matchClientePattern === '' ? null : form.matchClientePattern,
      motoristaNome: form.type === 'RESIDENCIA' && form.motoristaNome !== '' ? form.motoristaNome : null,
      latitude: form.latitude === '' ? null : Number(form.latitude),
      longitude: form.longitude === '' ? null : Number(form.longitude),
      raioMetros: form.raioMetros === '' ? null : Number(form.raioMetros),
      polygon: form.polygon,
    }
    const res = await fetch(editingId ? `/api/admin/locations/${editingId}` : '/api/admin/locations', {
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
    if (!confirm('Excluir este local?')) return
    const res = await fetch(`/api/admin/locations/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Falha ao excluir')
      return
    }
    load()
  }

  async function importLocations(rows: Record<string, string>[]): Promise<string> {
    let created = 0
    let updated = 0
    let skipped = 0
    const errors: string[] = []
    let snapshot = locations
    for (const row of rows) {
      const name = String(row['Nome'] ?? '').trim()
      const officialName = String(row['Nome real (ERP)'] ?? '').trim() || null
      const tipoRaw = String(row['Tipo'] ?? '').trim().toUpperCase()
      const type =
        (Object.keys(TYPE_LABEL) as LocationType[]).find(
          (t) => t === tipoRaw || TYPE_LABEL[t].toUpperCase() === tipoRaw,
        ) ?? 'UNIDADE'
      const coligadaRaw = String(row['Coligada'] ?? '').trim()
      const filialRaw = String(row['Filial'] ?? '').trim()
      const matchClientePattern = String(row['Trecho do nome'] ?? '').trim() || null
      const motoristaNome = String(row['Motorista'] ?? '').trim() || null
      const latitudeRaw = String(row['Latitude'] ?? '').trim()
      const longitudeRaw = String(row['Longitude'] ?? '').trim()
      const raioRaw = String(row['Raio (m)'] ?? '').trim()
      if (!name) {
        skipped++
        continue
      }
      const payload = {
        name,
        officialName,
        type,
        matchColigada: coligadaRaw === '' ? null : Number(coligadaRaw),
        matchFilial: filialRaw === '' ? null : Number(filialRaw),
        matchClientePattern,
        motoristaNome: type === 'RESIDENCIA' ? motoristaNome : null,
        latitude: latitudeRaw === '' ? null : Number(latitudeRaw),
        longitude: longitudeRaw === '' ? null : Number(longitudeRaw),
        raioMetros: raioRaw === '' ? null : Number(raioRaw),
      }
      const existing = snapshot.find((l) => l.name.toUpperCase() === name.toUpperCase())
      const res = await fetch(existing ? `/api/admin/locations/${existing.id}` : '/api/admin/locations', {
        method: existing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        if (existing) updated++
        else created++
      } else {
        const body = await res.json().catch(() => ({}))
        errors.push(`${name}: ${body.error ?? 'falha ao salvar'}`)
      }
    }
    const res = await fetch('/api/admin/locations')
    if (res.ok) {
      snapshot = await res.json()
      setLocations(snapshot)
    }
    const parts = [`${created} novo(s)`, `${updated} atualizado(s)`]
    if (skipped) parts.push(`${skipped} ignorado(s) (faltou nome)`)
    if (errors.length) parts.push(`erros: ${errors.slice(0, 3).join('; ')}${errors.length > 3 ? '…' : ''}`)
    return parts.join(', ')
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Locais</h1>
        <p className="text-sm text-slate-500">
          Unidades do grupo (casam por coligada/filial) e clientes (casam por trecho do nome na venda) definem
          as rotas. Cidade, posto, oficina e residência são só pontos de referência geográfica — entram nos
          relatórios de permanência (rastreamento) mas não casam viagens.
        </p>
      </div>

      <form onSubmit={save} className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-medium">{editingId ? 'Editar local' : 'Novo local'}</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-6">
          <div>
            <label className="block text-xs font-medium text-slate-600">Nome amigável</label>
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Nome real (ERP)</label>
            <input
              value={form.officialName}
              onChange={(e) => setForm({ ...form, officialName: e.target.value })}
              placeholder="como está no TOTVS"
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Tipo</label>
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as LocationType })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            >
              {(Object.keys(TYPE_LABEL) as LocationType[]).map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </div>
          {form.type === 'RESIDENCIA' && (
            <div>
              <label className="block text-xs font-medium text-slate-600">Nome do motorista</label>
              <input
                value={form.motoristaNome}
                onChange={(e) => setForm({ ...form, motoristaNome: e.target.value })}
                placeholder="ex.: JOÃO DA SILVA"
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              />
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-slate-600">Coligada (unidade)</label>
            <input
              type="number"
              value={form.matchColigada}
              onChange={(e) => setForm({ ...form, matchColigada: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Filial (unidade)</label>
            <input
              type="number"
              value={form.matchFilial}
              onChange={(e) => setForm({ ...form, matchFilial: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Trecho do nome (cliente)</label>
            <input
              value={form.matchClientePattern}
              onChange={(e) => setForm({ ...form, matchClientePattern: e.target.value })}
              placeholder="ex.: PALMYRA"
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Latitude</label>
            <input
              type="number"
              step="any"
              value={form.latitude}
              onChange={(e) => setForm({ ...form, latitude: e.target.value })}
              placeholder="ex.: -19.9227"
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Longitude</label>
            <input
              type="number"
              step="any"
              value={form.longitude}
              onChange={(e) => setForm({ ...form, longitude: e.target.value })}
              placeholder="ex.: -43.9451"
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Raio (metros)</label>
            <input
              type="number"
              step="any"
              value={form.raioMetros}
              onChange={(e) => setForm({ ...form, raioMetros: e.target.value })}
              placeholder="500"
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          Latitude/longitude e raio são usados para nominar em qual local um caminhão está a partir da
          posição GPS (integração Omnilink) — preencher quando souber as coordenadas do local, ou desenhar
          no mapa abaixo (círculo ou polígono, para locais com formato irregular).
        </p>
        <div className="mt-3">
          <LocationShapeMap
            key={editingId ?? 'novo'}
            value={{
              latitude: form.latitude === '' ? null : Number(form.latitude),
              longitude: form.longitude === '' ? null : Number(form.longitude),
              raioMetros: form.raioMetros === '' ? null : Number(form.raioMetros),
              polygon: form.polygon,
            }}
            onChange={(v) =>
              setForm((prev) => ({
                ...prev,
                latitude: v.latitude != null ? String(v.latitude) : '',
                longitude: v.longitude != null ? String(v.longitude) : '',
                raioMetros: v.raioMetros != null ? String(v.raioMetros) : '',
                polygon: v.polygon,
              }))
            }
          />
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

      {pending.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          <h2 className="font-medium text-amber-900">
            Unidades encontradas nos dados sem cadastro ({pending.length})
          </h2>
          <p className="text-sm text-amber-800">
            Apareceram nas sincronizações mas não casam com nenhum Local. Clique em cadastrar e dê um
            nome amigável — o nome real do ERP já vem preenchido.
          </p>
          <div className="mt-2 space-y-1">
            {pending.map((p) => (
              <div
                key={`${p.coligada}/${p.filial}`}
                className="flex items-center justify-between rounded-md bg-white px-3 py-1.5 text-sm"
              >
                <span>
                  <span className="font-mono text-xs text-slate-500">
                    {p.coligada}/{p.filial}
                  </span>{' '}
                  <span className="font-medium">{p.nomeReal || '(sem nome no ERP)'}</span>
                  <span className="ml-2 text-xs text-slate-500">{p.viagens} viagens</span>
                </span>
                <button
                  onClick={() => startFromPending(p)}
                  className="rounded-md border border-emerald-600 px-3 py-1 text-xs text-emerald-700 hover:bg-emerald-50"
                >
                  Cadastrar
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {pendingOficinas.length > 0 && (
        <div className="rounded-xl border border-violet-300 bg-violet-50 p-4">
          <h2 className="font-medium text-violet-900">
            Possíveis oficinas encontradas no rastreamento ({pendingOficinas.length})
          </h2>
          <p className="text-sm text-violet-800">
            Placas em manutenção ficaram um bom tempo (GPS) num ponto sem Local cadastrado — confira e
            dê um nome para registrar como Oficina.
          </p>
          <div className="mt-2 space-y-1">
            {pendingOficinas.map((p, i) => (
              <div
                key={`${p.latitude}-${p.longitude}-${i}`}
                className="flex items-center justify-between rounded-md bg-white px-3 py-1.5 text-sm"
              >
                <span>
                  <span className="font-mono text-xs text-slate-500">
                    {p.latitude.toFixed(5)}, {p.longitude.toFixed(5)}
                  </span>{' '}
                  <span className="font-medium">
                    ~{p.horasEstimadas}h parado(s) ({p.nPosicoes} posições)
                  </span>
                  <span className="ml-2 text-xs text-slate-500">placa(s): {p.placas.join(', ')}</span>
                </span>
                <button
                  onClick={() => startFromPendingOficina(p)}
                  className="rounded-md border border-violet-600 px-3 py-1 text-xs text-violet-700 hover:bg-violet-50"
                >
                  Cadastrar como Oficina
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <span className="font-medium">Locais cadastrados ({filteredLocations.length})</span>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="filtrar nome, nome real, tipo, trecho…"
              className="w-72 rounded-md border border-slate-300 px-2 py-1 text-sm"
            />
            <ExcelButtons
              exportFilename="locais.xlsx"
              exportRows={() =>
                filteredLocations.map((l) => ({
                  Nome: l.name,
                  'Nome real (ERP)': l.officialName ?? '',
                  Tipo: TYPE_LABEL[l.type],
                  Coligada: l.matchColigada ?? '',
                  Filial: l.matchFilial ?? '',
                  'Trecho do nome': l.matchClientePattern ?? '',
                  Motorista: l.motoristaNome ?? '',
                  Latitude: l.latitude ?? '',
                  Longitude: l.longitude ?? '',
                  'Raio (m)': l.raioMetros ?? '',
                }))
              }
              onImport={importLocations}
            />
          </div>
        </div>
        <p className="border-b border-slate-100 px-4 py-2 text-[11px] text-slate-500">
          Importação espera as colunas <strong>Nome</strong>, <strong>Nome real (ERP)</strong>,{' '}
          <strong>Tipo</strong> (Unidade/Cliente/Cidade/Posto de gasolina/Oficina/Residência),{' '}
          <strong>Coligada</strong>, <strong>Filial</strong>, <strong>Trecho do nome</strong>,{' '}
          <strong>Motorista</strong> (só para Residência), <strong>Latitude</strong>,{' '}
          <strong>Longitude</strong> e <strong>Raio (m)</strong>. Nome já cadastrado é atualizado; nome novo é
          criado.
        </p>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              <th className="px-3 py-2">Nome</th>
              <th className="px-3 py-2">Nome real (ERP)</th>
              <th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2">Coligada</th>
              <th className="px-3 py-2">Filial</th>
              <th className="px-3 py-2">Trecho do nome / Motorista</th>
              <th className="px-3 py-2">GPS</th>
              <th className="px-3 py-2">Rotas</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {filteredLocations.map((l) => (
              <tr key={l.id} className="border-t border-slate-100">
                <td className="px-3 py-2 font-medium">{l.name}</td>
                <td className="px-3 py-2 text-xs text-slate-500">{l.officialName ?? '—'}</td>
                <td className="px-3 py-2">
                  <span className={`rounded px-1.5 py-0.5 text-xs ${TYPE_BADGE[l.type]}`}>{TYPE_LABEL[l.type]}</span>
                </td>
                <td className="px-3 py-2">{l.matchColigada ?? '—'}</td>
                <td className="px-3 py-2">{l.matchFilial ?? '—'}</td>
                <td className="px-3 py-2">{l.type === 'RESIDENCIA' ? (l.motoristaNome ?? '—') : (l.matchClientePattern ?? '—')}</td>
                <td className="px-3 py-2 text-xs text-slate-500">
                  {l.polygon && l.polygon.length >= 3
                    ? `Polígono (${l.polygon.length} pontos)`
                    : l.latitude != null && l.longitude != null
                      ? `${l.latitude.toFixed(4)}, ${l.longitude.toFixed(4)} (${l.raioMetros ?? 500}m)`
                      : '—'}
                </td>
                <td className="px-3 py-2">{(l._count?.routesFrom ?? 0) + (l._count?.routesTo ?? 0)}</td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => startEdit(l)} className="text-emerald-700 hover:underline">
                    Editar
                  </button>
                  <button onClick={() => remove(l.id)} className="ml-3 text-red-600 hover:underline">
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
