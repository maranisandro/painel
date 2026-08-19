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

// ACHADO REAL 2026-08-19: a API da Omnilink trabalha em horário de Brasília
// (GMT-3), não UTC — confirmado ao vivo comparando o relógio UTC real no
// momento da chamada com o `envio_recepcao` da posição mais recente
// devolvida (diferença de ~3h, batendo exatamente com o fuso). Antes disso,
// `inicio`/`fim` eram formatados em UTC (assumindo que a API também usava
// UTC) e `parseEnvioRecepcao` (abaixo) tratava a resposta como se já fosse
// UTC — os dois lados com o mesmo erro, fazendo toda posição gravada
// parecer sistematicamente 3h mais antiga do que realmente é.
const OFFSET_BRASILIA_MS = 3 * 3_600_000

function fmtDataHora(d: Date): string {
  // "YYYY-MM-DD HH:MM:SS" em horário de Brasília (GMT-3) — formato que a API espera.
  return new Date(d.getTime() - OFFSET_BRASILIA_MS).toISOString().slice(0, 19).replace('T', ' ')
}

/**
 * Placas da frota própria conhecida (mesmo critério do controle de
 * combustível: já teve frete Próprio) — exportada para reuso pela lista de
 * "sem comunicação" (`/api/fase1/rastreamento/sem-comunicacao`), que precisa
 * do universo completo de placas, não só das que já têm posição.
 */
export async function placasProprias(): Promise<string[]> {
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

/**
 * "30/07/2026 20:00:00 - 31/07/2026 16:07:31" → Date da PRIMEIRA data (envio
 * do rastreador). O horário vem em GMT-3 (Brasília, ver achado 2026-08-19
 * acima) — `-03:00` explícito faz o JS converter para o instante UTC certo,
 * em vez do antigo `Z` (que tratava a hora local como se já fosse UTC).
 */
export function parseEnvioRecepcao(s: string): Date | null {
  const primeira = s.split(' - ')[0]?.trim()
  const m = primeira?.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/)
  if (!m) return null
  const [, dd, mm, yyyy, hh, mi, ss] = m
  const d = new Date(`${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}-03:00`)
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
type RespostaPagina = { res: Response; body: { dados?: { tabela?: ExternalRow[] } | string; mensagem?: string } | null }

async function consultarPagina(baseUrl: string, token: string, placa: string, parte: number, inicio: Date, fim: Date): Promise<RespostaPagina> {
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
  const body = (await res.json().catch(() => null)) as RespostaPagina['body']
  return { res, body }
}

/** true quando a resposta indica que o token em cache não é mais válido no lado da Omnilink (independente do nosso TTL local de 23h ainda não ter vencido). */
function tokenInvalido(body: RespostaPagina['body']): boolean {
  return typeof body?.dados === 'string' && body.dados.includes('Token inválido')
}

export async function fetchPosicoesDaPlaca(
  source: DataSource,
  placa: string,
  inicio: Date,
  fim: Date,
): Promise<ResultadoPlacaOmnilink> {
  const baseUrl = baseUrlDe(source)
  let token = await login(source)
  const linhas: ExternalRow[] = []
  try {
    for (let parte = 1; parte <= MAX_PARTES; parte++) {
      let { res, body } = await consultarPagina(baseUrl, token, placa, parte, inicio, fim)

      // ACHADO REAL 2026-08-17: o sync automático ficou dias travado com
      // "Token inválido" repetido — a Omnilink pode invalidar o token do
      // lado dela antes do nosso cache local (TTL de 23h) achar que venceu,
      // e sem essa detecção o conector simplesmente abortava a sincronização
      // inteira toda vez, para sempre, até o processo reiniciar. Um retry
      // (forçando novo login) resolve sem precisar reiniciar nada.
      if (res.status === 401 && tokenInvalido(body)) {
        tokenCache = null
        token = await login(source)
        ;({ res, body } = await consultarPagina(baseUrl, token, placa, parte, inicio, fim))
      }

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

// Teto de janela por execução — achado real 2026-08-17/18: com o schedule
// parado por dias (ou o servidor de produção reiniciando por OOM, já
// registrado antes), a marca d'água pode ficar dias/semanas atrasada; puxar
// o atraso inteiro de uma vez (potencialmente centenas de milhares de linhas,
// já que o dataset tem 700 mil+ linhas e cresce rápido) é o que historicamente
// estourou a memória do container em produção — o processo cai, a
// sincronização nunca termina, a marca d'água nunca avança, e o atraso só
// cresce. Limitando a janela, cada execução processa no máximo esse período;
// se o atraso for maior, as execuções seguintes (a cada 30 min) recuperam o
// resto aos poucos, sem nunca segurar mais que ~1 dia de dados em memória.
const JANELA_MAXIMA_MS = 24 * 3_600_000

// Placas por execução — pedido do usuário 2026-08-18: "fazer as consultas
// com um agrupamento menor de placas". Em vez de tentar a frota inteira
// (~35-40 placas) a cada execução, cada ciclo processa só um lote; o resto
// fica pra próxima execução (schedule de 30 min). Reduz a duração de cada
// sincronização e, mais importante, o "estrago" de um erro real numa placa
// (que ainda aborta a execução inteira) — com lote menor, o máximo que se
// perde é esse lote, não a frota toda.
const PLACAS_POR_EXECUCAO = 15

export async function fetchOmnilinkPosicoes(
  source: DataSource,
  _dataset: Dataset,
  watermark: string | null,
  syncRunId?: string,
): Promise<ExternalRow[]> {
  const agora = new Date()
  // Piso padrão: marca d'água do dataset inteiro, ou última hora se ainda
  // não houver nenhuma (1ª sincronização) — usado só como fallback para
  // placas sem nenhuma posição própria conhecida ainda.
  const inicioPadrao = watermark ? new Date(watermark) : new Date(agora.getTime() - 3_600_000)

  const todasPlacas = await placasProprias()
  if (todasPlacas.length === 0) return []

  // Rodízio: prioriza as placas que estão há mais tempo sem NENHUMA tentativa
  // de sincronização (incluindo buscas individuais via "buscar agora") — uma
  // placa nunca tentada (sem registro em OmnilinkSyncPlaca) tem prioridade
  // máxima. Sem precisar de nenhum estado novo: cada execução naturalmente
  // continua de onde a anterior parou, e placas com erro/exceção também são
  // repriorizadas (não ficam pra trás só porque falharam da última vez).
  const ultimasTentativas = await prisma.omnilinkSyncPlaca.groupBy({
    by: ['placa'],
    where: { placa: { in: todasPlacas } },
    _max: { createdAt: true },
  })
  const ultimaTentativaPorPlaca = new Map(ultimasTentativas.map((p) => [p.placa, p._max.createdAt]))
  const placas = [...todasPlacas]
    .sort((a, b) => (ultimaTentativaPorPlaca.get(a)?.getTime() ?? 0) - (ultimaTentativaPorPlaca.get(b)?.getTime() ?? 0))
    .slice(0, PLACAS_POR_EXECUCAO)

  // Início por placa (pedido do usuário 2026-08-18: "para cada caminhão
  // podemos pegar os dados a partir da última viagem/posição, na tentativa
  // de buscar menos dados") — em vez de toda placa recomeçar da MESMA marca
  // d'água única do dataset (que fica presa no atraso da placa mais
  // parada/problemática), cada placa busca a partir da SUA PRÓPRIA última
  // posição já persistida. Uma placa já em dia (ex.: atualizada por "buscar
  // agora") só busca o intervalo pequeno que falta, em vez de reprocessar
  // dias de dados que já tem — reduz bastante o volume por execução.
  const ultimasPosicoes = await prisma.vehiclePosition.groupBy({
    by: ['placa'],
    where: { placa: { in: placas } },
    _max: { capturedAt: true },
  })
  const ultimaPosicaoPorPlaca = new Map(ultimasPosicoes.map((p) => [p.placa, p._max.capturedAt]))

  // IMPORTANTE (achado ao vivo 2026-07-30): se UMA única placa do array não
  // for reconhecida pela conta Omnilink, a API rejeita a consulta INTEIRA
  // com "Placa não localizada" — não filtra, não avisa qual. Como nem toda
  // placa da frota própria necessariamente tem rastreador instalado/ativado,
  // a consulta precisa ser placa por placa: "não localizada" vira "sem
  // dados desta placa" (não interrompe as demais); qualquer OUTRO erro
  // (token, rede, etc.) continua interrompendo a sincronização.
  const linhas: ExternalRow[] = []
  for (const placa of placas) {
    const ultimaConhecida = ultimaPosicaoPorPlaca.get(placa)
    const inicio = ultimaConhecida && ultimaConhecida > inicioPadrao ? ultimaConhecida : inicioPadrao
    const fim = new Date(Math.min(agora.getTime(), inicio.getTime() + JANELA_MAXIMA_MS))
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
