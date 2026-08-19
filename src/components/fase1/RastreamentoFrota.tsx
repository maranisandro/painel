'use client'

import { useEffect, useMemo, useState } from 'react'
import { MapaFrota } from './MapaFrota'
import { DateRangeInputs, formatBRInput, parseBRToIso, fmtDateBR, MiniCalendarButton } from '@/components/shared/DateRangeInputs'
import { SortableTable } from '@/components/shared/SortableTable'

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
  /** primeira chegada e última saída observadas nesse cluster (qualquer placa) — pedido do usuário 2026-08-19, levado pro cadastro do Local */
  primeiraChegada?: string
  ultimaSaida?: string
}

interface SemComunicacaoInfo {
  placa: string
  situacao: 'SEM_RASTREADOR' | 'SEM_COMUNICACAO'
  ultimaPosicaoEm: string | null
  localizacao: string | null
  minutosSemComunicacao: number | null
  ultimoStatusSincronizacao: string | null
  ultimaTentativaEm: string | null
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
  const [tab, setTab] = useState<'mapa' | 'lista' | 'permanencia' | 'pernoite' | 'sem-comunicacao'>('mapa')
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

  // Lista combinada de placas sem rastreador/sem comunicação (pedido do
  // usuário 2026-08-19: "gere uma lista junto com a última posição das
  // placas que não estou encontrando o rastreador... trabalhar junto com
  // estes que certamente estão travados, assim trabalhamos direto com o
  // fornecedor") — ver /api/fase1/rastreamento/sem-comunicacao.
  const [semComunicacao, setSemComunicacao] = useState<SemComunicacaoInfo[]>([])
  const [carregandoSemComunicacao, setCarregandoSemComunicacao] = useState(false)
  const [filtroSemComunicacao, setFiltroSemComunicacao] = useState('')
  const [ordenacaoSemComunicacao, setOrdenacaoSemComunicacao] = useState<{ campo: 'placa' | 'minutos'; asc: boolean }>({
    campo: 'minutos',
    asc: false,
  })

  const loadSemComunicacao = async () => {
    setCarregandoSemComunicacao(true)
    const res = await fetch('/api/fase1/rastreamento/sem-comunicacao')
    setSemComunicacao(res.ok ? await res.json() : [])
    setCarregandoSemComunicacao(false)
  }

  useEffect(() => {
    if (tab === 'sem-comunicacao') void loadSemComunicacao()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  const semComunicacaoFiltrada = useMemo(() => {
    const f = filtroSemComunicacao.trim().toUpperCase()
    const lista = f ? semComunicacao.filter((r) => r.placa.includes(f)) : semComunicacao
    const { campo, asc } = ordenacaoSemComunicacao
    const ordenada = [...lista].sort((a, b) => {
      const va = campo === 'placa' ? a.placa : (a.minutosSemComunicacao ?? Infinity)
      const vb = campo === 'placa' ? b.placa : (b.minutosSemComunicacao ?? Infinity)
      const cmp = typeof va === 'string' ? va.localeCompare(String(vb)) : va - (vb as number)
      return asc ? cmp : -cmp
    })
    return ordenada
  }, [semComunicacao, filtroSemComunicacao, ordenacaoSemComunicacao])

  function alternarOrdenacaoSemComunicacao(campo: 'placa' | 'minutos') {
    setOrdenacaoSemComunicacao((prev) => (prev.campo === campo ? { campo, asc: !prev.asc } : { campo, asc: true }))
  }

  function exportarSemComunicacaoCsv() {
    const header = ['Placa', 'Situação', 'Última posição', 'Localização', 'Há quanto tempo', 'Último status de sincronização'].join(';')
    const linhas = semComunicacaoFiltrada.map((r) =>
      [
        r.placa,
        r.situacao === 'SEM_RASTREADOR' ? 'Sem rastreador' : 'Sem comunicação',
        r.ultimaPosicaoEm ? fmtDataHora(r.ultimaPosicaoEm) : 'nunca',
        r.localizacao ?? '',
        r.minutosSemComunicacao != null ? fmtDuracao(r.minutosSemComunicacao) : '—',
        r.ultimoStatusSincronizacao ?? '—',
      ]
        .map((v) => String(v).replace(/;/g, ','))
        .join(';'),
    )
    const csv = '﻿' + [header, ...linhas].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `placas_sem_comunicacao_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
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
  const [loteAntesDeTexto, setLoteAntesDeTexto] = useState('')
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
                  type="text"
                  inputMode="numeric"
                  value={loteAntesDeTexto}
                  onChange={(e) => {
                    const formatted = formatBRInput(e.target.value)
                    setLoteAntesDeTexto(formatted)
                    const iso = parseBRToIso(formatted)
                    if (iso) setLoteAntesDe(iso)
                  }}
                  placeholder="dd/mm/aaaa"
                  maxLength={10}
                  className="ml-1 w-24 rounded-md border border-slate-300 px-2 py-1 text-xs"
                />
              </label>
              <MiniCalendarButton
                valueIso={loteAntesDe}
                onSelect={(iso) => {
                  setLoteAntesDe(iso)
                  setLoteAntesDeTexto(fmtDateBR(iso))
                }}
              />
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
                {salvandoLote ? 'Salvando…' : `Reconhecer todos antes de ${loteAntesDe ? fmtDateBR(loteAntesDe) : '…'}`}
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
        {(['mapa', 'lista', 'permanencia', 'pernoite', 'sem-comunicacao'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px rounded-t-md border border-b-0 px-4 py-2 text-sm font-medium transition-colors ${
              tab === t
                ? 'border-slate-200 bg-emerald-700 text-white shadow-sm'
                : 'border-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-700'
            }`}
          >
            {t === 'mapa'
              ? 'Mapa'
              : t === 'lista'
                ? 'Última posição'
                : t === 'permanencia'
                  ? 'Permanência'
                  : t === 'pernoite'
                    ? 'Pernoite'
                    : 'Sem comunicação'}
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
          <SortableTable
            rows={positions}
            rowKey={(p) => p.placa}
            defaultSortKey="atualizado"
            emptyMessage="Nenhuma posição de caminhão no momento."
            columns={[
              {
                key: 'placa',
                label: 'Placa',
                sortValue: (p) => p.placa,
                render: (p) => (
                  <button onClick={() => verNoMapa(p.placa)} className="font-mono font-medium text-emerald-700 hover:underline">
                    {p.placa}
                  </button>
                ),
              },
              { key: 'atualizado', label: 'Atualizado', sortValue: (p) => new Date(p.capturedAt).getTime(), render: (p) => <span title={fmtDataHora(p.capturedAt)}>{haQuanto(p.capturedAt)}</span> },
              { key: 'status', label: 'Status', sortValue: (p) => p.status ?? '—', render: (p) => p.status ?? '—' },
              {
                key: 'sentido',
                label: 'Sentido',
                sortValue: (p) => (p.localAtual ? `no local: ${p.localAtual.nome}` : (p.sentido ?? '—')),
                render: (p) =>
                  p.localAtual ? (
                    <LocalAtualBadge localAtual={p.localAtual} ultimaComunicacao={p.capturedAt} />
                  ) : p.sentido ? (
                    <span className={`rounded px-2 py-0.5 text-xs ${SENTIDO_CLASS[p.sentido]}`}>{SENTIDO_LABEL[p.sentido]}</span>
                  ) : (
                    <span className="text-slate-400">—</span>
                  ),
              },
              { key: 'velocidade', label: 'Velocidade', align: 'right', sortValue: (p) => p.speedKmh ?? -1, render: (p) => (p.speedKmh != null ? `${p.speedKmh} km/h` : '—') },
              { key: 'localizacao', label: 'Localização', sortValue: (p) => p.localizacao ?? '—', render: (p) => <span className="text-slate-600">{p.localizacao ?? '—'}</span> },
              {
                key: 'historico',
                label: '',
                sortValue: () => '',
                render: (p) => (
                  <button onClick={() => abrirHistorico(p.placa)} className="text-emerald-700 hover:underline">
                    histórico
                  </button>
                ),
              },
            ]}
          />
        </div>
      ) : tab === 'permanencia' ? (
        <div>
          <div className="mb-3 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3">
            <DateRangeInputs from={permFrom} to={permTo} onFromChange={setPermFrom} onToChange={setPermTo} />
            <span className="text-xs text-slate-500">
              {carregandoPermanencia ? 'carregando…' : `${permanencias.length} visita(s) no período`}
            </span>
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <SortableTable
              rows={permanencias}
              rowKey={(v) => v.id}
              defaultSortKey="chegada"
              emptyMessage="Nenhuma visita a local cadastrado no período."
              columns={[
                { key: 'placa', label: 'Placa', sortValue: (v) => v.placa, render: (v) => <span className="font-mono font-medium">{v.placa}</span> },
                {
                  key: 'local',
                  label: 'Local',
                  sortValue: (v) => v.localNome,
                  render: (v) => (
                    <>
                      {v.localNome}
                      {v.motoristaResidencia && <span className="ml-1 text-xs text-slate-500">({v.motoristaResidencia})</span>}
                    </>
                  ),
                },
                { key: 'tipo', label: 'Tipo', sortValue: (v) => v.localTipo, render: (v) => <span className="text-xs text-slate-500">{v.localTipo}</span> },
                { key: 'chegada', label: 'Chegada', sortValue: (v) => new Date(v.chegada).getTime(), render: (v) => <span className="whitespace-nowrap">{fmtDataHora(v.chegada)}</span> },
                {
                  key: 'saida',
                  label: 'Saída',
                  sortValue: (v) => (v.saida ? new Date(v.saida).getTime() : Infinity),
                  render: (v) =>
                    v.saida ? (
                      <span className="whitespace-nowrap">{fmtDataHora(v.saida)}</span>
                    ) : (
                      <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-800">ainda está lá</span>
                    ),
                },
                { key: 'duracao', label: 'Duração', align: 'right', sortValue: (v) => v.duracaoMinutos ?? Infinity, render: (v) => fmtDuracao(v.duracaoMinutos) },
              ]}
            />
          </div>
        </div>
      ) : tab === 'pernoite' ? (
        <div>
          <div className="mb-3 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3">
            <DateRangeInputs from={pernFrom} to={pernTo} onFromChange={setPernFrom} onToChange={setPernTo} />
            <span className="text-xs text-slate-500">
              {carregandoPernoite ? 'carregando…' : `${pernoites.length} pernoite(s) no período`}
            </span>
          </div>

          <div className="mb-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-3 py-2 text-xs font-semibold text-slate-600">
              Locais mais frequentes de pernoite
            </div>
            <SortableTable
              rows={resumoPernoite}
              rowKey={(r) => r.nome}
              defaultSortKey="noites"
              emptyMessage="Nenhum pernoite identificado no período."
              columns={[
                { key: 'local', label: 'Local', sortValue: (r) => r.nome, render: (r) => r.nome },
                {
                  key: 'tipo',
                  label: 'Tipo',
                  sortValue: (r) => r.tipo ?? 'sem cadastro',
                  render: (r) => (r.tipo ?? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">sem cadastro</span>),
                },
                { key: 'noites', label: 'Noites', align: 'right', sortValue: (r) => r.noites, render: (r) => <span className="font-medium">{r.noites}</span> },
                { key: 'placas', label: 'Placas', sortValue: (r) => r.placas.join(', '), render: (r) => <span className="font-mono text-xs text-slate-600">{r.placas.join(', ')}</span> },
                {
                  key: 'acoes',
                  label: '',
                  sortValue: () => '',
                  render: (r) =>
                    // só locais sem cadastro têm lat/lng no resumo — pedido do
                    // usuário 2026-08-17: "clicar e ir para o mapa identificar
                    // o local para o devido cadastro"
                    r.latitude != null && r.longitude != null ? (
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
                            cadastrar (Cadastros → Locais já com lat/lng prontos).
                            Chegada/saída também vão junto (pedido do usuário
                            2026-08-19: "colocar a data e horario da chegada e
                            data e horario de saida"). */}
                        <a
                          href={`/dashboard/admin/locais?lat=${r.latitude}&lng=${r.longitude}${r.primeiraChegada ? `&chegada=${encodeURIComponent(r.primeiraChegada)}` : ''}${r.ultimaSaida ? `&saida=${encodeURIComponent(r.ultimaSaida)}` : ''}`}
                          target="_blank"
                          rel="noreferrer"
                          className="whitespace-nowrap rounded bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-200"
                        >
                          ➕ cadastrar local
                        </a>
                      </div>
                    ) : null,
                },
              ]}
            />
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-3 py-2 text-xs font-semibold text-slate-600">
              Detalhe por noite
            </div>
            <SortableTable
              rows={pernoites}
              rowKey={(p) => `${p.placa}-${p.noite}`}
              defaultSortKey="noite"
              emptyMessage="Nenhum pernoite identificado no período."
              columns={[
                { key: 'placa', label: 'Placa', sortValue: (p) => p.placa, render: (p) => <span className="font-mono font-medium">{p.placa}</span> },
                { key: 'noite', label: 'Noite', sortValue: (p) => p.noite, render: (p) => <span className="whitespace-nowrap">{fmtDataCurta(p.noite)}</span> },
                {
                  key: 'local',
                  label: 'Local',
                  sortValue: (p) => p.localNome ?? 'sem cadastro',
                  render: (p) =>
                    p.localNome ?? (
                      <span className="text-xs text-slate-500">
                        {p.latitude.toFixed(4)}, {p.longitude.toFixed(4)} (sem cadastro)
                      </span>
                    ),
                },
                { key: 'primeira', label: 'Primeira posição', sortValue: (p) => new Date(p.primeiraHora).getTime(), render: (p) => <span className="whitespace-nowrap">{fmtDataHora(p.primeiraHora)}</span> },
                { key: 'ultima', label: 'Última posição', sortValue: (p) => new Date(p.ultimaHora).getTime(), render: (p) => <span className="whitespace-nowrap">{fmtDataHora(p.ultimaHora)}</span> },
              ]}
            />
          </div>
        </div>
      ) : (
        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3">
            <div>
              <p className="text-sm text-slate-600">
                {carregandoSemComunicacao
                  ? 'carregando…'
                  : `${semComunicacaoFiltrada.length} placa(s) sem rastreador ou sem comunicação`}
              </p>
              <p className="text-xs text-slate-500">
                Lista pronta pra levar direto ao suporte da Omnilink — placas nunca localizadas ou com posição parada há mais de 2h.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                value={filtroSemComunicacao}
                onChange={(e) => setFiltroSemComunicacao(e.target.value)}
                placeholder="Filtrar por placa…"
                className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              />
              <button
                onClick={exportarSemComunicacaoCsv}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-50"
              >
                Exportar CSV
              </button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="cursor-pointer px-3 py-2 hover:bg-slate-100" onClick={() => alternarOrdenacaoSemComunicacao('placa')}>
                    Placa {ordenacaoSemComunicacao.campo === 'placa' ? (ordenacaoSemComunicacao.asc ? '▲' : '▼') : ''}
                  </th>
                  <th className="px-3 py-2">Situação</th>
                  <th
                    className="cursor-pointer px-3 py-2 hover:bg-slate-100"
                    onClick={() => alternarOrdenacaoSemComunicacao('minutos')}
                  >
                    Há quanto tempo {ordenacaoSemComunicacao.campo === 'minutos' ? (ordenacaoSemComunicacao.asc ? '▲' : '▼') : ''}
                  </th>
                  <th className="px-3 py-2">Última posição</th>
                  <th className="px-3 py-2">Localização</th>
                  <th className="px-3 py-2">Última tentativa de sincronização</th>
                </tr>
              </thead>
              <tbody>
                {semComunicacaoFiltrada.map((r) => (
                  <tr key={r.placa} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-mono font-medium">{r.placa}</td>
                    <td className="px-3 py-2">
                      {r.situacao === 'SEM_RASTREADOR' ? (
                        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">sem rastreador</span>
                      ) : (
                        <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-800">sem comunicação</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {r.minutosSemComunicacao != null ? fmtDuracao(r.minutosSemComunicacao) : 'nunca'}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap" title={r.ultimaPosicaoEm ? fmtDataHora(r.ultimaPosicaoEm) : ''}>
                      {r.ultimaPosicaoEm ? fmtDataHora(r.ultimaPosicaoEm) : '—'}
                    </td>
                    <td className="max-w-xs truncate px-3 py-2 text-slate-600" title={r.localizacao ?? ''}>
                      {r.localizacao ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {r.ultimaTentativaEm ? `${fmtDataHora(r.ultimaTentativaEm)} (${r.ultimoStatusSincronizacao})` : '—'}
                    </td>
                  </tr>
                ))}
                {!carregandoSemComunicacao && semComunicacaoFiltrada.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                      Nenhuma placa sem rastreador ou sem comunicação — tudo em dia.
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
