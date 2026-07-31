import type { DataSource, Dataset } from '@prisma/client'
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
 * usado pelo `authType: "session-login"` da Controladoria), pra não precisar
 * de migration só por causa da estratégia de busca.
 *
 * Formato exato da resposta (nomes de campo do token e de cada posição)
 * ainda não confirmado com uma chamada real — `extrairToken`/o mapeamento
 * de campos tentam os nomes mais prováveis e falham com uma mensagem clara
 * se não reconhecerem o formato, em vez de adivinhar silenciosamente.
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
  const body = (await res.json()) as Record<string, unknown>
  const token =
    (body.token as string | undefined) ??
    (body.access_token as string | undefined) ??
    (body.accessToken as string | undefined) ??
    ((body.data as Record<string, unknown> | undefined)?.token as string | undefined)
  if (!token || typeof token !== 'string') {
    throw new Error(
      `Login Omnilink não retornou um token reconhecível. Corpo da resposta: ${JSON.stringify(body).slice(0, 300)}`,
    )
  }
  tokenCache = { token, expiraEm: Date.now() + TOKEN_TTL_MS }
  return token
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

export async function fetchOmnilinkPosicoes(
  source: DataSource,
  _dataset: Dataset,
  watermark: string | null,
): Promise<ExternalRow[]> {
  const baseUrl = baseUrlDe(source)
  const token = await login(source)

  const fim = new Date()
  // Sem marca d'água ainda (1ª sincronização): últimas 24h, para não puxar
  // meses de histórico de uma vez. Sincronizações seguintes usam a última
  // posição já sincronizada como início.
  const inicio = watermark ? new Date(watermark) : new Date(fim.getTime() - 24 * 3_600_000)

  const placas = await placasProprias()
  if (placas.length === 0) return []

  const linhas: ExternalRow[] = []
  for (let parte = 1; parte <= MAX_PARTES; parte++) {
    const res = await fetch(`${baseUrl}/api/omniturbo/relatorios/posicoes`, {
      method: 'POST',
      headers: { 'x-access-token': token, accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inicio: fmtDataHora(inicio),
        fim: fmtDataHora(fim),
        placas,
        withSinalVida: true,
        parte,
      }),
    })
    if (!res.ok) {
      const texto = await res.text().catch(() => '')
      throw new Error(`Consulta de posições Omnilink falhou (status ${res.status}, parte ${parte}): ${texto.slice(0, 300)}`)
    }
    const body = (await res.json()) as unknown
    const pagina: unknown = Array.isArray(body)
      ? body
      : ((body as Record<string, unknown>)?.data ??
        (body as Record<string, unknown>)?.registros ??
        (body as Record<string, unknown>)?.resultado ??
        (body as Record<string, unknown>)?.rows ??
        [])
    if (!Array.isArray(pagina) || pagina.length === 0) break
    linhas.push(...(pagina as ExternalRow[]))
  }
  return linhas
}
