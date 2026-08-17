import type { DataSource, Dataset } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { type ExternalRow, envFor } from '../types'
import { getDatasetView } from '@/lib/semantic/dataset-view'

/**
 * Conector da API Turbo da Omnilink (Show Tecnologia) — pedido do usuário
 * 2026-07-30. Especificação passada pelo usuário:
 *  1. Login: POST /api/login {user, password} → token (válido 24h), usado
 *     depois no header `x-access-token`.
 *  2. Consulta: POST /api/omniturbo/relatorios/posicoes com intervalo de
 *     datas + placas + `withSinalVida` + `parte` (paginação — repetir
 *     incrementando `parte` até a página vir vazia).
 *
 * Não é um DataSource.type novo — reaproveita WEBSERVICE com
 * `config.connectorMode: "omnilink-turbo"` (mesmo padrão de extensão já
 * usado pelo `authType: "session-login"` da Controladoria).
 *
 * Formato real confirmado ao vivo em 2026-07-30 (`dados.tabela[]`), bem
 * diferente do que um JSON "limpo" teria — quase todo campo é uma string
 * formatada, exige parsing:
 *  - `lat_log`: "21°26'55.29\"S / 43°36'36.44\"W" (graus/min/seg, não
 *    decimal) → `parseLatLog`.
 *  - `envio_recepcao`: "30/07/2026 20:00:00 - 31/07/2026 16:07:31" (envio
 *    do rastreador - recepção do servidor) → usa a primeira data (quando a
 *    posição realmente aconteceu, não quando o servidor recebeu).
 *  - `velocidade_sentido`: "-/Norte" (velocidade/direção cardinal em texto,
 *    não em graus) → `parseVelocidadeSentido`.
 *  - `causa`/`estado`: motivo do evento e status do rastreador — sem campo
 *    próprio no schema, combinados em `status`.
 *
 * `withSinalVida: false` (o exemplo do usuário usava `true`): testado ao
 * vivo — com `true`, uma placa trouxe 42 mil registros em ~2,5 dias (sinal
 * de vida = keepalive do equipamento, não movimento real); com `false`,
 * ~16 registros/hora. Para o mapa (onde está o caminhão agora), sinal de
 * vida é ruído — reduz o volume ~1000x sem perder posição real.
 */

const BASE_URL_PADRAO = 'https://api.showtecnologia.com'
// 23h de folga sobre a validade real de 24h informada pelo usuário — margem
// de segurança para não usar um token que expira no meio de uma sincronização.
const TOKEN_TTL_MS = 23 * 60 * 60 * 1000
const MAX_PARTES = 200 // trava de segurança contra paginação que nunca some

let tokenCache: { token: string; expiraEm: number } | null = null

function baseUrlDe(source: DataSource): string {
  const config = (source.config ?? {}) as { baseUrl?: string }
  return config.baseUrl ?? BASE_URL_PADRAO
}

async function login(source: DataSource): Promise<string> {
  if (tokenCache && tokenCache.expiraEm > Date.now()) return tokenCache.token
  const baseUrl = baseUrlDe(source)
  const res = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: envFor(source, 'USER'), password: envFor(source, 'PASSWORD') }),
  })
  if (!res.ok) {
    const texto = await res.text().catch(() => '')
    throw new Error(`Login Omnilink falhou (status ${res.status}): ${texto.slice(0, 300)}`)
  }
  const body = (await res.json()) as { token?: string }
  if (!body.token) {
    throw new Error(`Login Omnilink não retornou token. Corpo da resposta: ${JSON.stringify(body).slice(0, 300)}`)
  }
  tokenCache = { token: body.token, expiraEm: Date.now() + TOKEN_TTL_MS }
  return body.token
}

function fmtDataHora(d: Date): string {
  // "YYYY-MM-DD HH:MM:SS" em UTC — formato do exemplo do usuário
  return d.toISOString().slice(0, 19).replace('T', ' ')
}

/** Placas da frota própria conhecida (mesmo critério do controle de combustível: já teve frete Próprio). */
async function placasProprias(): Promise<string[]> {
  const view = await getDatasetView('fase1_vendas_transporte')
  const set = new Set<string>()
  for (const r of view as Record<string, unknown>[]) {
    if (String(r['Consolida Transportadora'] ?? '') === 'Proprio') {
      const p = String(r.PLACA ?? '').trim().toUpperCase()
      if (p) set.add(p)
    }
  }
  return [...set]
}

/**
 * "21°26'55.29"S / 43°36'36.44"W" → {lat: -21.44869..., lng: -43.61012...}
 * (graus/minutos/segundos para decimal; S e W ficam negativos).
 */
export function parseLatLog(latLog: string): { lat: number; lng: number } | null {
  const m = latLog.match(/(\d+)°(\d+)'([\d.]+)"?\s*([NS])\s*\/\s*(\d+)°(\d+)'([\d.]+)"?\s*([EW])/)
  if (!m) return null
  const [, latD, latM, latS, latDir, lngD, lngM, lngS, lngDir] = m
  let lat = Number(latD) + Number(latM) / 60 + Number(latS) / 3600
  let lng = Number(lngD) + Number(lngM) / 60 + Number(lngS) / 3600
  if (latDir === 'S') lat = -lat
  if (lngDir === 'W') lng = -lng
  return { lat, lng }
}

/** "30/07/2026 20:00:00 - 31/07/2026 16:07:31" → Date da PRIMEIRA data (envio do rastreador). */
export function parseEnvioRecepcao(s: string): Date | null {
  const primeira = s.split(' - ')[0]?.trim()
  const m = primeira?.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/)
  if (!m) return null
  const [, dd, mm, yyyy, hh, mi, ss] = m
  const d = new Date(`${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

const DIRECOES_GRAUS: Record<string, number> = {
  Norte: 0,
  Nordeste: 45,
  Leste: 90,
  Sudeste: 135,
  Sul: 180,
  Sudoeste: 225,
  Oeste: 270,
  Noroeste: 315,
}

/**
 * "-/Sul" (parado) ou "98,0 km/h/Nordeste" (em movimento) → {speedKmh, heading
 * em graus}. Formato real descoberto ao vivo em 2026-08-03 — diferente do
 * assumido inicialmente ("-/Norte"): quando em movimento, a velocidade vem
 * com vírgula decimal E contém sua própria barra ("km/h"), então o texto tem
 * 3 segmentos por "/", não 2 — a direção é sempre o ÚLTIMO segmento.
 */
export function parseVelocidadeSentido(s: string): { speedKmh: number | null; heading: number | null } {
  const partes = s.split('/')
  const dirRaw = partes[partes.length - 1]?.trim()
  const velRaw = partes.slice(0, -1).join('/').trim()
  const speedKmh =
    velRaw && velRaw !== '-' ? Number(velRaw.replace(/[^\d,.-]/g, '').replace(',', '.')) || null : null
  const heading = dirRaw ? (DIRECOES_GRAUS[dirRaw] ?? null) : null
  return { speedKmh, heading }
}

export type ResultadoPlacaOmnilink = {
  linhas: ExternalRow[]
  status: 'OK' | 'NAO_LOCALIZADA' | 'ERRO'
  mensagem: string | null
}

/**
 * Busca as posições de UMA placa no intervalo [inicio, fim]. Extraído de
 * `fetchOmnilinkPosicoes` para ser reutilizado também pela busca individual
 * sob demanda (`buscarPosicaoIndividual`, `src/lib/sync/omnilink-manual.ts`)
 * — pedido do usuário 2026-08-17: "tentar os que estão a muito tempo parado
 * individualmente".
 */
export async function fetchPosicoesDaPlaca(
  source: DataSource,
  placa: string,
  inicio: Date,
  fim: Date,
): Promise<ResultadoPlacaOmnilink> {
  const baseUrl = baseUrlDe(source)
  const token = await login(source)
  const linhas: ExternalRow[] = []
  try {
    for (let parte = 1; parte <= MAX_PARTES; parte++) {
      const res = await fetch(`${baseUrl}/api/omniturbo/relatorios/posicoes`, {
        method: 'POST',
        headers: { 'x-access-token': token, accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inicio: fmtDataHora(inicio),
          fim: fmtDataHora(fim),
          placas: [placa],
          withSinalVida: false,
          parte,
        }),
      })
      const body = (await res.json().catch(() => null)) as { dados?: { tabela?: ExternalRow[] } | string; mensagem?: string } | null
      if (!res.ok) {
        // IMPORTANTE (achado ao vivo 2026-07-30): "placa não localizada" não é
        // um erro de sincronização — é essa placa específica sem rastreador
        // instalado/ativado. "parte inválida" é só o fim da paginação (a API
        // erra em vez de devolver página vazia).
        if (typeof body?.dados === 'string' && body.dados.includes('não localizada')) {
          return { linhas: [], status: 'NAO_LOCALIZADA', mensagem: null }
        }
        if (typeof body?.mensagem === 'string' && body.mensagem.includes('parte inválida')) break
        const texto = JSON.stringify(body).slice(0, 300)
        throw new Error(`Consulta de posições Omnilink falhou (status ${res.status}, placa ${placa}, parte ${parte}): ${texto}`)
      }
      const pagina = typeof body?.dados === 'object' ? body.dados?.tabela : undefined
      if (!Array.isArray(pagina) || pagina.length === 0) break

      // Enriquece cada linha com um campo ISO próprio para marca d'água/chave
      // primária — o campo original (`envio_recepcao`) é um intervalo em
      // texto (DD/MM/AAAA), não ordena corretamente como string simples.
      for (const row of pagina) {
        const capturedAt = parseEnvioRecepcao(String(row.envio_recepcao ?? ''))
        if (capturedAt) row._capturedAtIso = capturedAt.toISOString()
        linhas.push(row)
      }
    }
    return { linhas, status: 'OK', mensagem: null }
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : String(err)
    return { linhas, status: 'ERRO', mensagem }
  }
}

export async function fetchOmnilinkPosicoes(
  source: DataSource,
  _dataset: Dataset,
  watermark: string | null,
  syncRunId?: string,
): Promise<ExternalRow[]> {
  const fim = new Date()
  // Sem marca d'água ainda (1ª sincronização): última hora, para não puxar
  // um histórico enorme de uma vez (mesmo sem sinal de vida, o volume é
  // considerável). Sincronizações seguintes usam a última posição já
  // sincronizada como início.
  const inicio = watermark ? new Date(watermark) : new Date(fim.getTime() - 3_600_000)

  const placas = await placasProprias()
  if (placas.length === 0) return []

  // IMPORTANTE (achado ao vivo 2026-07-30): se UMA única placa do array não
  // for reconhecida pela conta Omnilink, a API rejeita a consulta INTEIRA
  // com "Placa não localizada" — não filtra, não avisa qual. Como nem toda
  // placa da frota própria necessariamente tem rastreador instalado/ativado,
  // a consulta precisa ser placa por placa: "não localizada" vira "sem
  // dados desta placa" (não interrompe as demais); qualquer OUTRO erro
  // (token, rede, etc.) continua interrompendo a sincronização.
  const linhas: ExternalRow[] = []
  for (const placa of placas) {
    const resultado = await fetchPosicoesDaPlaca(source, placa, inicio, fim)
    linhas.push(...resultado.linhas)

    // Log detalhado por placa (pedido do usuário 2026-08-17: "vamos precisar
    // de um log mais detalhado para as recuperações do omnilink") — sem isso
    // o SyncRun só tinha um total agregado da sincronização inteira inteira,
    // sem dar pra saber qual placa parou de responder e quando.
    if (syncRunId) {
      let ultimaPosicaoEm: Date | null = null
      for (const row of resultado.linhas) {
        if (!row._capturedAtIso) continue
        const d = new Date(String(row._capturedAtIso))
        if (!ultimaPosicaoEm || d > ultimaPosicaoEm) ultimaPosicaoEm = d
      }
      await prisma.omnilinkSyncPlaca.create({
        data: {
          syncRunId,
          placa,
          status: resultado.status,
          rowsRecebidas: resultado.linhas.length,
          ultimaPosicaoEm,
          mensagem: resultado.mensagem,
        },
      })
    }

    // Erro genuíno (não "não localizada") continua interrompendo a
    // sincronização inteira, como antes — só que agora o log da placa que
    // falhou já ficou registrado acima antes de propagar o erro.
    if (resultado.status === 'ERRO') {
      throw new Error(resultado.mensagem ?? `Falha desconhecida ao buscar posições da placa ${placa}`)
    }
  }
  return linhas
}
