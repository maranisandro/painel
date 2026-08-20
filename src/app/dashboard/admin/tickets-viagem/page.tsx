'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

interface TripTicket {
  id: string
  placa: string | null
  pesoAproximadoTon: string | null
  dataTicket: string | null
  fileName: string
  fileMime: string
  ocrStatus: 'processando' | 'reconhecido' | 'falhou'
  ocrTexto: string | null
  ocrLog: string[]
  ocrProgress: number
  matchedTripKeys: string[]
  conferidoEm: string | null
  conferidoPor: string | null
  createdAt: string
}

interface Trip {
  VIAGEM_KEY: string
  PLACA: string
  DATASAIDA: string
  PESOLIQUIDO: number
  NOMEFANTASIA: string
  MOTORISTA: string
  NUMEROMOV: string
}

type OcrProvider = 'tesseract' | 'anthropic' | 'openai'

const EMPTY_MANUAL = { placa: '', pesoAproximadoTon: '', dataTicket: '' }
const PROVIDER_LABEL: Record<OcrProvider, string> = {
  tesseract: 'Tesseract (local)',
  anthropic: 'IA de visão (Anthropic, Haiku)',
  openai: 'IA de visão (OpenAI, gpt-4o-mini)',
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

function normPlaca(v: string): string {
  return v.trim().toUpperCase()
}

/**
 * Conciliação de tickets de viagem (foto/PDF de pesagem) com as notas fiscais
 * já emitidas — pedido do usuário 2026-08-03, refinado várias vezes no mesmo
 * dia: upload aceita vários arquivos de uma vez, cada um processado (OCR +
 * tentativa de auto-conciliação) em segundo plano sem travar a tela; um
 * ticket pode ser conciliado com mais de uma nota/viagem; e há uma pasta
 * opcional que o painel varre sozinho de tempos em tempos (vigia de pasta).
 */
export default function TicketsViagemPage() {
  const [tickets, setTickets] = useState<TripTicket[]>([])
  const [trips, setTrips] = useState<Trip[]>([])

  const [ocrProvider, setOcrProvider] = useState<OcrProvider>('tesseract')
  const [aiConfigurado, setAiConfigurado] = useState({ anthropic: false, openai: false })

  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  const [manualForms, setManualForms] = useState<Record<string, typeof EMPTY_MANUAL>>({})
  const [selecionadas, setSelecionadas] = useState<Record<string, Set<string>>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [reprocessando, setReprocessando] = useState(false)

  const loadTickets = useCallback(async () => {
    const res = await fetch('/api/admin/trip-tickets')
    if (res.ok) setTickets(await res.json())
  }, [])

  const loadTrips = useCallback(async () => {
    const res = await fetch('/api/admin/trip-tickets/trips')
    if (res.ok) setTrips(await res.json())
  }, [])

  // Reprocessa tickets presos em "processando" (achado real 2026-08-19/20:
  // subir muitos arquivos de uma vez trava o Tesseract em ~5% pra sempre,
  // sem erro nenhum) — reprocessa todos com o motor de OCR atual (ex.: já
  // trocado pra OpenAI), protegido pela fila de concorrência limitada.
  async function reprocessarTravados() {
    setReprocessando(true)
    await fetch('/api/admin/trip-tickets/reprocessar-travados', { method: 'POST' })
    setReprocessando(false)
    await loadTickets()
  }

  async function reprocessarUm(id: string) {
    setBusyId(id)
    await fetch(`/api/admin/trip-tickets/${id}/reprocessar`, { method: 'POST' })
    setBusyId(null)
    await loadTickets()
  }

  useEffect(() => {
    void loadTickets()
    void loadTrips()
    fetch('/api/admin/ocr-config')
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (!body) return
        setOcrProvider(body.provider)
        setAiConfigurado({ anthropic: body.anthropicConfigurado, openai: body.openaiConfigurado })
      })
  }, [loadTickets, loadTrips])

  // Enquanto algum ticket ainda está "processando" (OCR em segundo plano),
  // repete a busca a cada 2s para acompanhar o log/andamento ao vivo.
  useEffect(() => {
    if (!tickets.some((t) => t.ocrStatus === 'processando')) return
    const timer = window.setInterval(() => void loadTickets(), 2000)
    return () => window.clearInterval(timer)
  }, [tickets, loadTickets])

  async function changeProvider(provider: OcrProvider) {
    setOcrProvider(provider)
    await fetch('/api/admin/ocr-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider }),
    })
  }

  const tripsByPlaca = useMemo(() => {
    const map = new Map<string, Trip[]>()
    for (const t of trips) {
      const key = normPlaca(String(t.PLACA ?? ''))
      const list = map.get(key) ?? []
      list.push(t)
      map.set(key, list)
    }
    return map
  }, [trips])

  // Nº da nota fiscal no nome do arquivo (ex.: "TICKET NF-e 10700.jpeg") —
  // quando bate exatamente com o NUMEROMOV de uma viagem da mesma placa, é
  // uma identificação muito mais forte que a proximidade de peso (que pode
  // falhar se o OCR leu o peso errado, ou a nota é só uma perna de uma
  // viagem maior) — achado real 2026-08-20: ticket com NF 10700 no nome não
  // aparecia entre as candidatas porque o peso lido (50,88t) batia mal com
  // o peso real da nota (27,69t), mas a NF batia certinho.
  function nfDoNomeArquivo(fileName: string): string | null {
    const m = fileName.match(/NF-?e?\s*(\d{3,})/i)
    return m ? m[1].replace(/^0+/, '') : null
  }

  function candidatesFor(ticket: TripTicket): (Trip & { diffTon: number; nfMatch: boolean })[] {
    if (!ticket.placa || ticket.pesoAproximadoTon == null) return []
    const list = tripsByPlaca.get(normPlaca(ticket.placa)) ?? []
    const pesoTicket = Number(ticket.pesoAproximadoTon)
    const nfTicket = nfDoNomeArquivo(ticket.fileName)
    const comDiff = list.map((t) => ({
      ...t,
      diffTon: Math.abs((Number(t.PESOLIQUIDO) || 0) / 1000 - pesoTicket),
      nfMatch: !!nfTicket && t.NUMEROMOV.replace(/^0+/, '') === nfTicket,
    }))
    const matchNf = comDiff.filter((t) => t.nfMatch)
    const semMatch = comDiff
      .filter((t) => !t.nfMatch)
      .sort((a, b) => a.diffTon - b.diffTon)
      .slice(0, 5 - matchNf.length)
    return [...matchNf, ...semMatch]
  }

  function tripByKey(key: string): Trip | undefined {
    return trips.find((t) => t.VIAGEM_KEY === key)
  }

  function toggleSelecionada(ticketId: string, tripKey: string) {
    setSelecionadas((prev) => {
      const atual = new Set(prev[ticketId] ?? [])
      if (atual.has(tripKey)) atual.delete(tripKey)
      else atual.add(tripKey)
      return { ...prev, [ticketId]: atual }
    })
  }

  async function upload(e: React.FormEvent) {
    e.preventDefault()
    const files = fileRef.current?.files
    if (!files || files.length === 0) {
      setError('Anexe ao menos um arquivo de ticket.')
      return
    }
    setUploading(true)
    setError('')
    const body = new FormData()
    for (const file of files) body.append('arquivo', file)
    const res = await fetch('/api/admin/trip-tickets', { method: 'POST', body })
    setUploading(false)
    if (!res.ok) {
      const b = await res.json().catch(() => ({}))
      setError(b.error ?? 'Falha ao enviar')
      return
    }
    if (fileRef.current) fileRef.current.value = ''
    await loadTickets()
  }

  async function enviarDadosManuais(ticketId: string) {
    const dados = manualForms[ticketId] ?? EMPTY_MANUAL
    if (!dados.placa || !dados.pesoAproximadoTon || !dados.dataTicket) return
    setBusyId(ticketId)
    const res = await fetch(`/api/admin/trip-tickets/${ticketId}/dados`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        placa: dados.placa,
        pesoAproximadoTon: Number(dados.pesoAproximadoTon),
        dataTicket: dados.dataTicket,
      }),
    })
    setBusyId(null)
    if (res.ok) {
      setManualForms((prev) => {
        const next = { ...prev }
        delete next[ticketId]
        return next
      })
      await loadTickets()
    }
  }

  async function conciliar(ticketId: string, tripKeys: string[]) {
    setBusyId(ticketId)
    const res = await fetch(`/api/admin/trip-tickets/${ticketId}/conciliar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tripKeys }),
    })
    setBusyId(null)
    if (res.ok) {
      setSelecionadas((prev) => ({ ...prev, [ticketId]: new Set() }))
      await loadTickets()
    }
  }

  async function remove(ticketId: string) {
    if (!confirm('Excluir este ticket?')) return
    setBusyId(ticketId)
    const res = await fetch(`/api/admin/trip-tickets/${ticketId}`, { method: 'DELETE' })
    setBusyId(null)
    if (res.ok) await loadTickets()
  }

  const processando = tickets.filter((t) => t.ocrStatus === 'processando')
  const precisaDados = tickets.filter((t) => t.ocrStatus !== 'processando' && (!t.placa || t.pesoAproximadoTon == null || !t.dataTicket))
  const pendentes = tickets.filter(
    (t) => t.placa && t.pesoAproximadoTon != null && t.dataTicket && t.matchedTripKeys.length === 0,
  )
  const conferidos = tickets.filter((t) => t.matchedTripKeys.length > 0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Conciliação de tickets de viagem</h1>
        <p className="text-sm text-slate-500">
          Suba a foto/PDF do ticket de pesagem (pode selecionar vários de uma vez) — o painel tenta ler
          placa, peso e data sozinho (OCR) e, achando uma viagem com peso bem próximo, já concilia
          automaticamente. Não conseguindo ler, pede para você preencher os 3 campos manualmente.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600">Motor de OCR</label>
            <select
              value={ocrProvider}
              onChange={(e) => changeProvider(e.target.value as OcrProvider)}
              className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="tesseract">{PROVIDER_LABEL.tesseract}</option>
              <option value="anthropic">{PROVIDER_LABEL.anthropic}</option>
              <option value="openai">{PROVIDER_LABEL.openai}</option>
            </select>
          </div>
          <p className="max-w-md text-xs text-slate-500">
            {ocrProvider === 'anthropic' && !aiConfigurado.anthropic
              ? 'Falta preencher ANTHROPIC_API_KEY no .env do servidor para este motor funcionar.'
              : ocrProvider === 'openai' && !aiConfigurado.openai
                ? 'Falta preencher OPENAI_API_KEY no .env do servidor para este motor funcionar.'
                : ocrProvider === 'tesseract'
                  ? 'Roda no próprio servidor, sem enviar o ticket para fora. Só lê imagem (não PDF) e tende a errar mais em texto manuscrito.'
                  : 'A imagem do ticket é enviada para a API de IA para leitura (usa o modelo mais barato de cada provedor).'}
          </p>
        </div>
      </div>

      <form onSubmit={upload} className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-medium">Novo(s) ticket(s)</h2>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600">Arquivos (foto/PDF, pode selecionar vários)</label>
            <input
              ref={fileRef}
              required
              type="file"
              multiple
              accept="image/*,.pdf"
              className="mt-1 rounded-md border border-slate-300 px-2 py-1 text-xs"
            />
          </div>
          <button
            type="submit"
            disabled={uploading}
            className="rounded-md bg-emerald-700 px-4 py-1.5 text-sm text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            {uploading ? 'Enviando…' : 'Enviar ticket(s)'}
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </form>

      {processando.length > 0 && (
        <div className="rounded-xl border border-sky-300 bg-sky-50">
          <div className="flex items-center justify-between border-b border-sky-200 px-4 py-3">
            <span className="font-medium text-sky-900">Processando OCR ({processando.length})</span>
            <button
              onClick={reprocessarTravados}
              disabled={reprocessando}
              title="Tickets presos em 'processando' há mais de 10 minutos travaram (achado real: Tesseract concorrente demais trava sem erro) — reprocessa todos com o motor de OCR atual"
              className="rounded-md border border-sky-600 px-3 py-1 text-xs text-sky-700 hover:bg-sky-100 disabled:opacity-50"
            >
              {reprocessando ? 'Reprocessando…' : 'Reprocessar travados (10+ min)'}
            </button>
          </div>
          <div className="divide-y divide-sky-200">
            {processando.map((ticket) => (
              <div key={ticket.id} className="px-4 py-3 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-sky-900">{ticket.fileName}</span>
                  <span className="font-mono text-sky-700">{ticket.ocrProgress}%</span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-sky-200">
                  <div
                    className="h-full bg-sky-600 transition-all"
                    style={{ width: `${Math.max(2, ticket.ocrProgress)}%` }}
                  />
                </div>
                <ul className="mt-1.5 space-y-0.5 text-sky-800">
                  {ticket.ocrLog.map((linha, i) => (
                    <li key={i}>{linha}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {precisaDados.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50">
          <div className="border-b border-amber-200 px-4 py-3 font-medium text-amber-900">
            OCR não conseguiu ler — preencher manualmente ({precisaDados.length})
          </div>
          <div className="divide-y divide-amber-200">
            {precisaDados.map((ticket) => {
              const dados = manualForms[ticket.id] ?? EMPTY_MANUAL
              return (
                <div key={ticket.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <a
                      href={`/api/admin/trip-tickets/${ticket.id}/arquivo`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-emerald-700 hover:underline"
                    >
                      ver ticket ({ticket.fileName})
                    </a>
                    <button
                      onClick={() => reprocessarUm(ticket.id)}
                      disabled={busyId === ticket.id}
                      className="ml-auto text-xs text-emerald-700 hover:underline"
                    >
                      reprocessar OCR
                    </button>
                    <button
                      onClick={() => remove(ticket.id)}
                      disabled={busyId === ticket.id}
                      className="text-xs text-red-600 hover:underline"
                    >
                      excluir
                    </button>
                  </div>
                  {ticket.ocrTexto && (
                    <p className="mt-1 max-w-2xl truncate text-[11px] text-amber-800" title={ticket.ocrTexto}>
                      texto lido pelo OCR: {ticket.ocrTexto.slice(0, 140)}
                    </p>
                  )}
                  <div className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-4">
                    <input
                      placeholder="Placa"
                      value={dados.placa}
                      onChange={(e) =>
                        setManualForms((prev) => ({ ...prev, [ticket.id]: { ...dados, placa: e.target.value.toUpperCase() } }))
                      }
                      className="rounded-md border border-slate-300 px-2 py-1.5 font-mono text-sm"
                    />
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      placeholder="Peso aproximado (t)"
                      value={dados.pesoAproximadoTon}
                      onChange={(e) =>
                        setManualForms((prev) => ({ ...prev, [ticket.id]: { ...dados, pesoAproximadoTon: e.target.value } }))
                      }
                      className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                    />
                    <input
                      type="date"
                      value={dados.dataTicket}
                      onChange={(e) =>
                        setManualForms((prev) => ({ ...prev, [ticket.id]: { ...dados, dataTicket: e.target.value } }))
                      }
                      className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                    />
                    <button
                      onClick={() => enviarDadosManuais(ticket.id)}
                      disabled={busyId === ticket.id || !dados.placa || !dados.pesoAproximadoTon || !dados.dataTicket}
                      className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm text-white hover:bg-emerald-800 disabled:opacity-50"
                    >
                      Salvar e buscar viagens
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3 font-medium">
          Pendentes de conciliação ({pendentes.length})
        </div>
        <div className="divide-y divide-slate-100">
          {pendentes.map((ticket) => {
            const candidates = candidatesFor(ticket)
            const marcadas = selecionadas[ticket.id] ?? new Set<string>()
            return (
              <div key={ticket.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-mono text-sm font-medium">{ticket.placa}</span>
                  <span className="text-sm text-slate-600">
                    {Number(ticket.pesoAproximadoTon).toLocaleString('pt-BR')} t · {fmtDate(ticket.dataTicket!)}
                  </span>
                  <a
                    href={`/api/admin/trip-tickets/${ticket.id}/arquivo`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-emerald-700 hover:underline"
                  >
                    ver ticket ({ticket.fileName})
                  </a>
                  <button
                    onClick={() => remove(ticket.id)}
                    disabled={busyId === ticket.id}
                    className="ml-auto text-xs text-red-600 hover:underline"
                  >
                    excluir
                  </button>
                </div>
                {candidates.length === 0 ? (
                  <p className="mt-2 text-xs text-slate-500">Nenhuma viagem desta placa encontrada.</p>
                ) : (
                  <>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {candidates.map((c) => {
                        const marcada = marcadas.has(c.VIAGEM_KEY)
                        return (
                          <label
                            key={c.VIAGEM_KEY}
                            className={`flex cursor-pointer items-start gap-2 rounded-md border px-3 py-1.5 text-left text-xs ${
                              marcada
                                ? 'border-emerald-500 bg-emerald-50'
                                : c.nfMatch
                                  ? 'border-cyan-400 bg-cyan-50 hover:bg-cyan-100'
                                  : 'border-slate-300 hover:bg-slate-50'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={marcada}
                              onChange={() => toggleSelecionada(ticket.id, c.VIAGEM_KEY)}
                              className="mt-0.5 h-3.5 w-3.5"
                            />
                            <div>
                              <div className="font-medium">
                                {fmtDate(c.DATASAIDA)} · NF {c.NUMEROMOV} · {((Number(c.PESOLIQUIDO) || 0) / 1000).toLocaleString('pt-BR')} t
                                {c.nfMatch && (
                                  <span className="ml-1 rounded bg-cyan-600 px-1 py-0.5 text-[10px] font-normal text-white" title="Número da nota fiscal bate com o nome do arquivo do ticket">
                                    NF do ticket
                                  </span>
                                )}
                              </div>
                              <div className="text-slate-500">
                                {c.NOMEFANTASIA} · {c.MOTORISTA} · diferença {c.diffTon.toLocaleString('pt-BR')} t
                              </div>
                            </div>
                          </label>
                        )
                      })}
                    </div>
                    <button
                      onClick={() => conciliar(ticket.id, [...marcadas])}
                      disabled={busyId === ticket.id || marcadas.size === 0}
                      className="mt-2 rounded-md bg-emerald-700 px-3 py-1.5 text-xs text-white hover:bg-emerald-800 disabled:opacity-50"
                    >
                      Conciliar {marcadas.size > 0 ? `${marcadas.size} nota(s) selecionada(s)` : ''}
                    </button>
                  </>
                )}
              </div>
            )
          })}
          {pendentes.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-slate-500">Nenhum ticket pendente.</p>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3 font-medium">
          Conciliados ({conferidos.length})
        </div>
        <div className="divide-y divide-slate-100">
          {conferidos.map((ticket) => {
            const tripsConciliadas = ticket.matchedTripKeys.map((k) => tripByKey(k)).filter(Boolean) as Trip[]
            return (
              <div key={ticket.id} className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
                <span className="font-mono font-medium">{ticket.placa}</span>
                <span className="text-slate-600">
                  {Number(ticket.pesoAproximadoTon).toLocaleString('pt-BR')} t · {fmtDate(ticket.dataTicket!)}
                </span>
                <a
                  href={`/api/admin/trip-tickets/${ticket.id}/arquivo`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-emerald-700 hover:underline"
                >
                  ver ticket
                </a>
                <span className="text-xs text-slate-500">
                  ↔{' '}
                  {tripsConciliadas.length > 0
                    ? tripsConciliadas
                        .map((t) => `NF ${t.NUMEROMOV} (${fmtDate(t.DATASAIDA)}, ${((Number(t.PESOLIQUIDO) || 0) / 1000).toLocaleString('pt-BR')} t)`)
                        .join(' + ')
                    : `${ticket.matchedTripKeys.length} viagem(ns) não encontrada(s) na carga atual`}
                </span>
                <span className="text-xs text-slate-400">
                  conferido por {ticket.conferidoPor} em {ticket.conferidoEm ? fmtDate(ticket.conferidoEm) : ''}
                </span>
                <button
                  onClick={() => conciliar(ticket.id, [])}
                  disabled={busyId === ticket.id}
                  className="ml-auto text-xs text-slate-500 hover:underline"
                >
                  desfazer
                </button>
              </div>
            )
          })}
          {conferidos.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-slate-500">Nenhum ticket conciliado ainda.</p>
          )}
        </div>
      </div>
    </div>
  )
}
