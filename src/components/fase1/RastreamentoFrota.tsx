'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { MapaFrota } from './MapaFrota'

interface LocationMarker {
  id: string
  name: string
  type: 'UNIDADE' | 'CLIENTE' | 'CIDADE' | 'POSTO_GASOLINA' | 'OFICINA' | 'RESIDENCIA'
  latitude: number | null
  longitude: number | null
  raioMetros: number
  polygon: { lat: number; lng: number }[] | null
}

type StatusViagem = 'EM_DIA' | 'ATRASADO' | 'MUITO_ATRASADO' | 'SEM_ROTA'

interface VehiclePositionInfo {
  placa: string
  latitude: number
  longitude: number
  speedKmh: number | null
  heading: number | null
  status: string | null
  localizacao: string | null
  capturedAt: string
  sentido: 'indo' | 'voltando' | null
  statusViagem: StatusViagem | null
  /** placa com VehicleMaintenance em aberto — destacada no mapa (pedido do usuário 2026-08-17) */
  emManutencao?: boolean
  /** parado num Local cadastrado (geofence) — quando presente, sobrepõe indo/voltando (pedido do usuário 2026-08-03, caso TBH2C02) */
  localAtual: { nome: string; tipo: string; chegada: string } | null
  /** dia da saída, previsão de retorno e velocidade média real da última viagem (pedido do usuário 2026-08-12, mostrado no balão do mapa) */
  ultimaViagem: { dataSaida: string | null; previsaoRetorno: string | null; velocidadeMediaKmh: number | null } | null
}

const SENTIDO_LABEL: Record<'indo' | 'voltando', string> = { indo: '→ indo', voltando: '← voltando' }
const SENTIDO_CLASS: Record<'indo' | 'voltando', string> = {
  indo: 'bg-blue-100 text-blue-800',
  voltando: 'bg-orange-100 text-orange-800',
}

const STATUS_VIAGEM_LABEL: Record<StatusViagem, string> = {
  EM_DIA: 'em dia',
  ATRASADO: 'atrasado',
  MUITO_ATRASADO: 'muito atrasado',
  SEM_ROTA: 'sem rota p/ comparar',
}
const STATUS_VIAGEM_CLASS: Record<StatusViagem, string> = {
  EM_DIA: 'bg-emerald-100 text-emerald-800',
  ATRASADO: 'bg-amber-100 text-amber-800',
  MUITO_ATRASADO: 'bg-red-100 text-red-800',
  SEM_ROTA: 'bg-slate-100 text-slate-500',
}
const STATUS_VIAGEM_ORDEM: Record<StatusViagem, number> = {
  MUITO_ATRASADO: 0,
  ATRASADO: 1,
  SEM_ROTA: 2,
  EM_DIA: 3,
}

interface HistoricoPonto {
  capturedAt: string
  latitude: number
  longitude: number
  speedKmh: number | null
  heading: number | null
  status: string | null
  localizacao: string | null
}

interface PermanenciaInfo {
  id: string
  placa: string
  localNome: string
  localTipo: string
  motoristaResidencia: string | null
  chegada: string
  saida: string | null
  duracaoMinutos: number | null
}

interface PernoiteInfo {
  placa: string
  noite: string
  latitude: number
  longitude: number
  localNome: string | null
  localTipo: string | null
  nPosicoes: number
  primeiraHora: string
  ultimaHora: string
}

interface ResumoPernoiteInfo {
  nome: string
  tipo: string | null
  noites: number
  placas: string[]
  /** só presente quando sem Local cadastrado (cluster de coordenadas) — usado pelo botão "ver no mapa" */
  latitude?: number
  longitude?: number
}

function fmtDuracao(min: number | null): string {
  if (min == null) return 'em andamento'
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m > 0 ? `${h}h${m}min` : `${h}h`
}

function minutosDesde(iso: string): number {
  return Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
}

// Acima disso, a última posição do rastreador é velha demais pra confiar no
// "parado há Xh" — pode ser um problema real de comunicação (rastreador
// morto), não necessariamente o veículo parado por tanto tempo assim. Achado
// real 2026-08-17: usuário reportou placas com "250h+ na Palmyra", que pode
// ser tanto um problema mecânico real quanto o rastreador que parou de
// responder — sem comparar com a última posição recebida não dá pra saber.
const LIMIAR_SEM_COMUNICACAO_MIN = 120

/** Badge "no local: X, há Yh" — sobrepõe indo/voltando quando o caminhão está parado num Local cadastrado (pedido do usuário 2026-08-03, caso TBH2C02). */
function LocalAtualBadge({
  localAtual,
  ultimaComunicacao,
}: {
  localAtual: { nome: string; chegada: string }
  /** capturedAt da última posição GPS conhecida da placa — usado só para o alerta de comunicação parada, não para a duração exibida */
  ultimaComunicacao?: string
}) {
  const minutosSemComunicacao = ultimaComunicacao != null ? minutosDesde(ultimaComunicacao) : null
  const semComunicacao = minutosSemComunicacao != null && minutosSemComunicacao > LIMIAR_SEM_COMUNICACAO_MIN
  return (
    <span
      className={`rounded px-2 py-0.5 text-xs ${semComunicacao ? 'bg-red-100 text-red-800' : 'bg-violet-100 text-violet-800'}`}
      title={
        semComunicacao
          ? `Última posição recebida há ${fmtDuracao(minutosSemComunicacao!)} (${fmtDataHora(ultimaComunicacao!)}) — pode ser rastreador sem comunicar, não necessariamente o veículo parado`
          : fmtDataHora(localAtual.chegada)
      }
    >
      {semComunicacao ? '⚠ sem comunicação · ' : ''}
      no local: {localAtual.nome} · há {fmtDuracao(minutosDesde(localAtual.chegada))}
    </span>
  )
}

interface SpeedAlertInfo {
  id: string
  placa: string
  speedKmh: number
  limiteKmh: number
  capturedAt: string
  localizacao: string | null
  acknowledgedAt: string | null
  acknowledgedBy: string | null
  motivo: string | null
}

function fmtDataHora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR')
}

/** 'YYYY-MM-DD' -> 'dd/mm/yyyy', sem passar por Date (evita deslocamento de fuso numa data pura). */
function fmtDataCurta(dataStr: string): string {
  const [y, m, d] = dataStr.split('-')
  return `${d}/${m}/${y}`
}

function haQuanto(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const horas = Math.round(min / 60)
  if (horas < 24) return `há ${horas}h`
  return `há ${Math.round(horas / 24)}d`
}

/**
 * Aba "Última posição" (tabela) + drill-down de histórico por placa (pedido
 * do usuário 2026-08-03: "gerar mais uma aba com a última informação do
 * rastreador, inserir no painel as informações recuperadas da viagem e o
 * histórico"). Histórico guarda até 60 dias — mais velho que isso é limpo a
 * cada sync (src/lib/sync/post-process.ts).
 */
export function RastreamentoFrota({
  locations,
  positions,
}: {
  locations: LocationMarker[]
  positions: VehiclePositionInfo[]
}) {
  const [tab, setTab] = useState<'mapa' | 'lista' | 'permanencia' | 'pernoite'>('mapa')
  const [historicoPlaca, setHistoricoPlaca] = useState<string | null>(null)
  const [historico, setHistorico] = useState<HistoricoPonto[]>([])
  const [carregandoHistorico, setCarregandoHistorico] = useState(false)
  const [erroHistorico, setErroHistorico] = useState<string | null>(null)

  // Placa selecionada fora do mapa (painel ao lado ou tabela) — centraliza e
  // abre o balão desse caminhão no mapa (pedido do usuário 2026-08-03:
  // "preciso clicar na placa e ver qual é o caminhão").
  const [selectedPlaca, setSelectedPlaca] = useState<string | null>(null)
  function verNoMapa(placa: string) {
    setSelectedPlaca(placa)
    setTab('mapa')
  }

  // Coordenada avulsa a focar no mapa (ex.: local de pernoite sem cadastro) —
  // pedido do usuário 2026-08-17: "é preciso clicar e ir para o mapa
  // identificar o local para o devido cadastro". Zera selectedPlaca para não
  // reabrir o balão de um caminhão junto por engano.
  const [focusCoord, setFocusCoord] = useState<{ lat: number; lng: number } | null>(null)
  function verCoordenadaNoMapa(lat: number, lng: number) {
    setSelectedPlaca(null)
    setFocusCoord({ lat, lng })
    setTab('mapa')
  }

  // Permanência por local (chegada/saída) — pedido do usuário 2026-08-03:
  // "relatórios do tempo que ficou em cada local, hora de chegada e saída".
  const [permanencias, setPermanencias] = useState<PermanenciaInfo[]>([])
  const [permFrom, setPermFrom] = useState(() => new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10))
  const [permTo, setPermTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [carregandoPermanencia, setCarregandoPermanencia] = useState(false)

  const loadPermanencias = async () => {
    setCarregandoPermanencia(true)
    const res = await fetch(`/api/fase1/rastreamento/permanencia?from=${permFrom}&to=${permTo}`)
    setPermanencias(res.ok ? await res.json() : [])
    setCarregandoPermanencia(false)
  }

  useEffect(() => {
    if (tab === 'permanencia') void loadPermanencias()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, permFrom, permTo])

  // Locais de pernoite — pedido do usuário 2026-08-17: "identificar os
  // locais que os caminhões estão ficando parados a noite". Mesma UX de
  // período do que a aba Permanência, mas por GPS bruto (não depende de
  // Local cadastrado) — ver src/app/api/fase1/rastreamento/pernoite/route.ts.
  const [pernoites, setPernoites] = useState<PernoiteInfo[]>([])
  const [resumoPernoite, setResumoPernoite] = useState<ResumoPernoiteInfo[]>([])
  const [pernFrom, setPernFrom] = useState(() => new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10))
  const [pernTo, setPernTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [carregandoPernoite, setCarregandoPernoite] = useState(false)

  const loadPernoites = async () => {
    setCarregandoPernoite(true)
    const res = await fetch(`/api/fase1/rastreamento/pernoite?from=${pernFrom}&to=${pernTo}`)
    if (res.ok) {
      const body = await res.json()
      setPernoites(body.pernoites)
      setResumoPernoite(body.resumo)
    } else {
      setPernoites([])
      setResumoPernoite([])
    }
    setCarregandoPernoite(false)
  }

  useEffect(() => {
    if (tab === 'pernoite') void loadPernoites()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, pernFrom, pernTo])

  // Alertas de excesso de velocidade — pedido do usuário 2026-08-03: precisam
  // de reconhecimento formal (motivo + usuário), não só aparecer no mapa.
  const [speedAlerts, setSpeedAlerts] = useState<SpeedAlertInfo[]>([])
  const [reconhecendoId, setReconhecendoId] = useState<string | null>(null)
  const [motivoInput, setMotivoInput] = useState('')
  const [salvandoReconhecimento, setSalvandoReconhecimento] = useState(false)

  // Reconhecimento em lote (pedido do usuário 2026-08-19: "limpar o excesso
  // de velocidade anterior a 17/08 para acompanhamento") — mesma exigência
  // de motivo do reconhecimento individual, só que aplicado a todos os
  // abertos antes de uma data de corte de uma vez.
  const [reconhecendoLote, setReconhecendoLote] = useState(false)
  const [loteAntesDe, setLoteAntesDe] = useState('')
  const [loteMotivo, setLoteMotivo] = useState('')
  const [salvandoLote, setSalvandoLote] = useState(false)

  const loadSpeedAlerts = async () => {
    const res = await fetch('/api/fase1/speed-alerts')
    if (res.ok) setSpeedAlerts(await res.json())
  }

  useEffect(() => {
    void loadSpeedAlerts()
  }, [])

  async function reconhecerExcesso(id: string) {
    if (motivoInput.trim().length < 3) return
    setSalvandoReconhecimento(true)
    const res = await fetch(`/api/fase1/speed-alerts/${id}/reconhecer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ motivo: motivoInput.trim() }),
    })
    setSalvandoReconhecimento(false)
    if (res.ok) {
      setReconhecendoId(null)
      setMotivoInput('')
      await loadSpeedAlerts()
    }
  }

  async function reconhecerLote() {
    if (!loteAntesDe || loteMotivo.trim().length < 3) return
    setSalvandoLote(true)
    const res = await fetch('/api/fase1/speed-alerts/reconhecer-lote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ antesDe: loteAntesDe, motivo: loteMotivo.trim() }),
    })
    setSalvandoLote(false)
    if (res.ok) {
      setReconhecendoLote(false)
      setLoteAntesDe('')
      setLoteMotivo('')
      await loadSpeedAlerts()
    }
  }

  async function abrirHistorico(placa: string) {
    setHistoricoPlaca(placa)
    setCarregandoHistorico(true)
    setErroHistorico(null)
    try {
      // Timeout de 15s — sem isso, uma resposta do servidor que nunca chega
      // (não só um erro explícito) também deixaria "Carregando…" pra sempre.
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 15_000)
      const res = await fetch(`/api/fase1/rastreamento/historico?placa=${encodeURIComponent(placa)}`, {
        signal: controller.signal,
      }).finally(() => clearTimeout(timeoutId))
      if (!res.ok) throw new Error(`Falha ao carregar histórico (status ${res.status})`)
      setHistorico(await res.json())
    } catch (err) {
      // ACHADO REAL 2026-08-19: sem isso, uma falha no fetch/JSON (rede,
      // erro 500, resposta inesperada) deixava "Carregando…" pra sempre —
      // nada nunca desligava o loading nesse caminho.
      setHistorico([])
      setErroHistorico(
        err instanceof Error && err.name === 'AbortError'
          ? 'O servidor demorou demais para responder (15s) — tente de novo.'
          : err instanceof Error
            ? err.message
            : 'Falha ao carregar histórico',
      )
    } finally {
      setCarregandoHistorico(false)
    }
  }

  const alertasAbertos = speedAlerts.filter((a) => !a.acknowledgedAt)
  const alertasReconhecidos = speedAlerts.filter((a) => a.acknowledgedAt)

  // Agrupado por status — pedido do usuário 2026-08-03: "agrupar as últimas
  // posições por placa e status, sempre trazendo o último status para parte
  // superior". Cada grupo (um status) sobe para o topo conforme a atualização
  // mais recente dentro dele; dentro do grupo, mais recente primeiro também.
  const grupos = useMemo(() => {
    const porStatus = new Map<string, VehiclePositionInfo[]>()
    for (const p of positions) {
      const chave = p.status ?? 'Sem status'
      const lista = porStatus.get(chave) ?? []
      lista.push(p)
      porStatus.set(chave, lista)
    }
    const arr = [...porStatus.entries()].map(([status, lista]) => {
      const ordenada = [...lista].sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime())
      return { status, veiculos: ordenada, ultimaAtualizacao: ordenada[0]?.capturedAt ?? '' }
    })
    arr.sort((a, b) => new Date(b.ultimaAtualizacao).getTime() - new Date(a.ultimaAtualizacao).getTime())
    return arr
  }, [positions])

  // Painel ao lado do mapa: indo/voltando + atrasado/em dia — pedido do
  // usuário 2026-08-03: "colocar uma tabela do que está indo e o que está
  // voltando, se está atrasado ou em dia em relação aos parâmetros do
  // sistema". Pior status primeiro (o que precisa de atenção sobe ao topo).
  const painelLateral = useMemo(
    () =>
      [...positions].sort((a, b) => {
        const oa = a.statusViagem ? STATUS_VIAGEM_ORDEM[a.statusViagem] : 99
        const ob = b.statusViagem ? STATUS_VIAGEM_ORDEM[b.statusViagem] : 99
        if (oa !== ob) return oa - ob
        return a.placa.localeCompare(b.placa)
      }),
    [positions],
  )

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-xl font-semibold">Rastreamento da frota</h1>
        <p className="mt-1 text-sm text-slate-500">Posição em tempo real (Omnilink) e histórico de até 60 dias.</p>
      </div>

      {alertasAbertos.length > 0 && (
        <div className="mb-4 space-y-2 rounded-xl border border-red-300 bg-red-50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-red-900">
              ⚠ {alertasAbertos.length} excesso(s) de velocidade sem reconhecimento
            </p>
            {!reconhecendoLote && (
              <button
                onClick={() => {
                  setReconhecendoLote(true)
                  setLoteMotivo('')
                }}
                className="shrink-0 rounded border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-800 hover:bg-red-50"
              >
                Reconhecer em lote…
              </button>
            )}
          </div>
          {reconhecendoLote && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2">
              <label className="text-xs text-slate-600">
                Antes de
                <input
                  type="date"
                  value={loteAntesDe}
                  onChange={(e) => setLoteAntesDe(e.target.value)}
                  className="ml-1 rounded-md border border-slate-300 px-2 py-1 text-xs"
                />
              </label>
              <input
                autoFocus
                value={loteMotivo}
                onChange={(e) => setLoteMotivo(e.target.value)}
                placeholder="Motivo (ex.: período anterior, fora do acompanhamento atual)"
                className="min-w-[280px] flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs"
              />
              <button
                onClick={reconhecerLote}
                disabled={salvandoLote || !loteAntesDe || loteMotivo.trim().length < 3}
                className="rounded bg-red-700 px-3 py-1 text-xs font-medium text-white hover:bg-red-800 disabled:opacity-50"
              >
                {salvandoLote ? 'Salvando…' : `Reconhecer todos antes de ${loteAntesDe || '…'}`}
              </button>
              <button
                onClick={() => setReconhecendoLote(false)}
                className="rounded border border-slate-300 px-3 py-1 text-xs hover:bg-slate-100"
              >
                Cancelar
              </button>
            </div>
          )}
          {alertasAbertos.map((a) => (
            <div key={a.id} className="rounded-lg border border-red-200 bg-white px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  <span className="font-mono font-medium">{a.placa}</span> atingiu{' '}
                  <span className="font-semibold text-red-700">{a.speedKmh} km/h</span> (limite {a.limiteKmh} km/h) em{' '}
                  {fmtDataHora(a.capturedAt)}
                  {a.localizacao && <span className="text-slate-500"> · {a.localizacao}</span>}
                </span>
                {reconhecendoId !== a.id && (
                  <button
                    onClick={() => {
                      setReconhecendoId(a.id)
                      setMotivoInput('')
                    }}
                    className="shrink-0 rounded bg-red-700 px-3 py-1 text-xs font-medium text-white hover:bg-red-800"
                  >
                    Reconhecer
                  </button>
                )}
              </div>
              {reconhecendoId === a.id && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    autoFocus
                    value={motivoInput}
                    onChange={(e) => setMotivoInput(e.target.value)}
                    placeholder="Motivo (ex.: trecho de descida, ultrapassagem, falha do rastreador…)"
                    className="min-w-[280px] flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs"
                  />
                  <button
                    onClick={() => reconhecerExcesso(a.id)}
                    disabled={salvandoReconhecimento || motivoInput.trim().length < 3}
                    className="rounded bg-emerald-700 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
                  >
                    {salvandoReconhecimento ? 'Salvando…' : 'Confirmar'}
                  </button>
                  <button
                    onClick={() => setReconhecendoId(null)}
                    className="rounded border border-slate-300 px-3 py-1 text-xs hover:bg-slate-100"
                  >
                    Cancelar
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {alertasReconhecidos.length > 0 && (
        <details className="mb-4 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
          <summary className="cursor-pointer text-slate-600">
            Excessos de velocidade já reconhecidos ({alertasReconhecidos.length})
          </summary>
          <ul className="mt-2 space-y-1 text-xs text-slate-600">
            {alertasReconhecidos.slice(0, 20).map((a) => (
              <li key={a.id}>
                <span className="font-mono font-medium">{a.placa}</span> — {a.speedKmh} km/h em{' '}
                {fmtDataHora(a.capturedAt)} · reconhecido por {a.acknowledgedBy} em{' '}
                {a.acknowledgedAt && fmtDataHora(a.acknowledgedAt)}
                {a.motivo && <> · motivo: {a.motivo}</>}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="mb-4 flex gap-1 border-b border-slate-200">
        {(['mapa', 'lista', 'permanencia', 'pernoite'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px rounded-t-md border border-b-0 px-4 py-2 text-sm font-medium transition-colors ${
              tab === t
                ? 'border-slate-200 bg-emerald-700 text-white shadow-sm'
                : 'border-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-700'
            }`}
          >
            {t === 'mapa' ? 'Mapa' : t === 'lista' ? 'Última posição' : t === 'permanencia' ? 'Permanência' : 'Pernoite'}
          </button>
        ))}
      </div>

      {tab === 'mapa' ? (
        <div className="flex flex-col gap-4 lg:flex-row">
          <div className="lg:w-3/5">
            <MapaFrota locations={locations} positions={positions} selectedPlaca={selectedPlaca} focusCoord={focusCoord} />
          </div>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white lg:w-2/5">
            <div className="border-b border-slate-100 px-3 py-2 text-xs font-semibold text-slate-600">
              Indo / voltando · situação vs. previsão · clique na placa para ver no mapa
            </div>
            <div className="max-h-[600px] overflow-y-auto">
              <table className="w-full text-sm">
                <tbody>
                  {painelLateral.map((p) => (
                    <tr
                      key={p.placa}
                      onClick={() => setSelectedPlaca(p.placa)}
                      className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${selectedPlaca === p.placa ? 'bg-emerald-50' : ''}`}
                    >
                      <td className="px-3 py-2 font-mono font-medium">
                        {p.placa}
                        {p.emManutencao && (
                          <span className="ml-1 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-800">
                            🔧 manutenção
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {p.localAtual ? (
                          <LocalAtualBadge localAtual={p.localAtual} ultimaComunicacao={p.capturedAt} />
                        ) : p.sentido ? (
                          <span className={`rounded px-2 py-0.5 text-xs ${SENTIDO_CLASS[p.sentido]}`}>
                            {SENTIDO_LABEL[p.sentido]}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">sentido —</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {p.statusViagem ? (
                          <span className={`rounded px-2 py-0.5 text-xs ${STATUS_VIAGEM_CLASS[p.statusViagem]}`}>
                            {STATUS_VIAGEM_LABEL[p.statusViagem]}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {painelLateral.length === 0 && (
                    <tr>
                      <td className="px-4 py-8 text-center text-sm text-slate-500">Nenhum caminhão com posição.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : tab === 'lista' ? (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-3 py-2">Placa</th>
                <th className="px-3 py-2">Atualizado</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Sentido</th>
                <th className="px-3 py-2 text-right">Velocidade</th>
                <th className="px-3 py-2">Localização</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {grupos.map((g) => (
                <React.Fragment key={g.status}>
                  <tr className="border-t border-slate-200 bg-slate-50">
                    <td colSpan={7} className="px-3 py-1.5 text-xs font-semibold text-slate-600">
                      {g.status} ({g.veiculos.length})
                    </td>
                  </tr>
                  {g.veiculos.map((p) => (
                    <tr key={p.placa} className="border-t border-slate-100">
                      <td className="px-3 py-2">
                        <button onClick={() => verNoMapa(p.placa)} className="font-mono font-medium text-emerald-700 hover:underline">
                          {p.placa}
                        </button>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap" title={fmtDataHora(p.capturedAt)}>
                        {haQuanto(p.capturedAt)}
                      </td>
                      <td className="px-3 py-2">{p.status ?? '—'}</td>
                      <td className="px-3 py-2">
                        {p.localAtual ? (
                          <LocalAtualBadge localAtual={p.localAtual} ultimaComunicacao={p.capturedAt} />
                        ) : p.sentido ? (
                          <span className={`rounded px-2 py-0.5 text-xs ${SENTIDO_CLASS[p.sentido]}`}>
                            {SENTIDO_LABEL[p.sentido]}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">{p.speedKmh != null ? `${p.speedKmh} km/h` : '—'}</td>
                      <td className="px-3 py-2 text-slate-600">{p.localizacao ?? '—'}</td>
                      <td className="px-3 py-2 text-right">
                        <button onClick={() => abrirHistorico(p.placa)} className="text-emerald-700 hover:underline">
                          histórico
                        </button>
                      </td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
              {grupos.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    Nenhuma posição de caminhão no momento.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : tab === 'permanencia' ? (
        <div>
          <div className="mb-3 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3">
            <div>
              <label className="block text-xs font-medium text-slate-600">De</label>
              <input
                type="date"
                value={permFrom}
                onChange={(e) => setPermFrom(e.target.value)}
                className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600">Até</label>
              <input
                type="date"
                value={permTo}
                onChange={(e) => setPermTo(e.target.value)}
                className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              />
            </div>
            <span className="text-xs text-slate-500">
              {carregandoPermanencia ? 'carregando…' : `${permanencias.length} visita(s) no período`}
            </span>
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2">Placa</th>
                  <th className="px-3 py-2">Local</th>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2">Chegada</th>
                  <th className="px-3 py-2">Saída</th>
                  <th className="px-3 py-2 text-right">Duração</th>
                </tr>
              </thead>
              <tbody>
                {permanencias.map((v) => (
                  <tr key={v.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-mono font-medium">{v.placa}</td>
                    <td className="px-3 py-2">
                      {v.localNome}
                      {v.motoristaResidencia && (
                        <span className="ml-1 text-xs text-slate-500">({v.motoristaResidencia})</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">{v.localTipo}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDataHora(v.chegada)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {v.saida ? (
                        fmtDataHora(v.saida)
                      ) : (
                        <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-800">ainda está lá</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">{fmtDuracao(v.duracaoMinutos)}</td>
                  </tr>
                ))}
                {permanencias.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                      Nenhuma visita a local cadastrado no período.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div>
          <div className="mb-3 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3">
            <div>
              <label className="block text-xs font-medium text-slate-600">De</label>
              <input
                type="date"
                value={pernFrom}
                onChange={(e) => setPernFrom(e.target.value)}
                className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600">Até</label>
              <input
                type="date"
                value={pernTo}
                onChange={(e) => setPernTo(e.target.value)}
                className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              />
            </div>
            <span className="text-xs text-slate-500">
              {carregandoPernoite ? 'carregando…' : `${pernoites.length} pernoite(s) no período`}
            </span>
          </div>

          <div className="mb-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-3 py-2 text-xs font-semibold text-slate-600">
              Locais mais frequentes de pernoite
            </div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2">Local</th>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2 text-right">Noites</th>
                  <th className="px-3 py-2">Placas</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {resumoPernoite.map((r) => (
                  <tr key={r.nome} className="border-t border-slate-100">
                    <td className="px-3 py-2">{r.nome}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      {r.tipo ?? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">sem cadastro</span>}
                    </td>
                    <td className="px-3 py-2 text-right font-medium">{r.noites}</td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-600">{r.placas.join(', ')}</td>
                    <td className="px-3 py-2">
                      {/* só locais sem cadastro têm lat/lng no resumo — pedido do
                          usuário 2026-08-17: "clicar e ir para o mapa identificar
                          o local para o devido cadastro" */}
                      {r.latitude != null && r.longitude != null && (
                        <div className="flex flex-wrap gap-1">
                          <button
                            onClick={() => verCoordenadaNoMapa(r.latitude!, r.longitude!)}
                            className="whitespace-nowrap rounded bg-violet-100 px-2 py-1 text-xs font-medium text-violet-800 hover:bg-violet-200"
                          >
                            📍 ver no mapa
                          </button>
                          {/* pedido do usuário 2026-08-19: "não me deixa cadastrar
                              o local, preciso desta opção" — depois de identificar
                              visualmente no mapa, precisa de um caminho direto pra
                              cadastrar (Cadastros → Locais já com lat/lng prontos). */}
                          <a
                            href={`/dashboard/admin/locais?lat=${r.latitude}&lng=${r.longitude}`}
                            target="_blank"
                            rel="noreferrer"
                            className="whitespace-nowrap rounded bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-200"
                          >
                            ➕ cadastrar local
                          </a>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {resumoPernoite.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                      Nenhum pernoite identificado no período.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-3 py-2 text-xs font-semibold text-slate-600">
              Detalhe por noite
            </div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2">Placa</th>
                  <th className="px-3 py-2">Noite</th>
                  <th className="px-3 py-2">Local</th>
                  <th className="px-3 py-2">Primeira posição</th>
                  <th className="px-3 py-2">Última posição</th>
                </tr>
              </thead>
              <tbody>
                {pernoites.map((p) => (
                  <tr key={`${p.placa}-${p.noite}`} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-mono font-medium">{p.placa}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDataCurta(p.noite)}</td>
                    <td className="px-3 py-2">
                      {p.localNome ?? (
                        <span className="text-xs text-slate-500">
                          {p.latitude.toFixed(4)}, {p.longitude.toFixed(4)} (sem cadastro)
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDataHora(p.primeiraHora)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDataHora(p.ultimaHora)}</td>
                  </tr>
                ))}
                {pernoites.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                      Nenhum pernoite identificado no período.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {historicoPlaca && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setHistoricoPlaca(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-4 shadow-xl"
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-medium">
                Histórico — <span className="font-mono">{historicoPlaca}</span>
              </h2>
              <button onClick={() => setHistoricoPlaca(null)} className="text-slate-500 hover:text-slate-800">
                ✕
              </button>
            </div>
            {carregandoHistorico ? (
              <p className="text-sm text-slate-500">Carregando…</p>
            ) : erroHistorico ? (
              <p className="text-sm text-red-700">⚠ {erroHistorico}</p>
            ) : historico.length === 0 ? (
              <p className="text-sm text-slate-500">Sem histórico nos últimos 60 dias.</p>
            ) : (
              <table className="w-full text-xs">
                <thead className="text-left text-slate-500">
                  <tr>
                    <th className="py-1 pr-2">Quando</th>
                    <th className="py-1 pr-2">Status</th>
                    <th className="py-1 pr-2 text-right">Velocidade</th>
                    <th className="py-1">Localização</th>
                  </tr>
                </thead>
                <tbody>
                  {historico.map((h, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="py-1 pr-2 whitespace-nowrap">{fmtDataHora(h.capturedAt)}</td>
                      <td className="py-1 pr-2">{h.status ?? '—'}</td>
                      <td className="py-1 pr-2 text-right">{h.speedKmh != null ? `${h.speedKmh} km/h` : '—'}</td>
                      <td className="py-1 text-slate-600">{h.localizacao ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
