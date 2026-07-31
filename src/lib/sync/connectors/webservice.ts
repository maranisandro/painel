import type { DataSource, Dataset } from '@prisma/client'
import { type Connector, type ExternalRow } from '../types'
import { fetchOmnilinkPosicoes } from './omnilink'

/**
 * Conector de Web Service REST.
 * - source.config: { baseUrl, authType?: "basic" | "bearer" | "session-login" | "none", rowsPath?,
 *   loginPath?, usernameField?, passwordField? }
 * - dataset.query: caminho relativo do endpoint (pode conter {{watermark}})
 * - Credenciais via env: <PREFIX>_USER/<PREFIX>_PASSWORD (basic e session-login) ou <PREFIX>_TOKEN (bearer)
 *
 * "session-login" (pedido do usuário 2026-07-30, API da Controladoria —
 * caderno-gerencial/custos-transporte-rodoviario): a aplicação não aceita
 * Basic Auth na API — só um login por formulário (`POST loginPath` com
 * username/password) que devolve um cookie de sessão (`Set-Cookie`), usado
 * depois na requisição do endpoint de dados. Login inválido responde 401 com
 * a própria página de login (não uma lista JSON) — tratado como erro.
 */
async function sessionLoginCookie(source: DataSource, config: { baseUrl?: string; loginPath?: string; usernameField?: string; passwordField?: string }): Promise<string> {
  const user = process.env[`${source.envPrefix}_USER`] ?? ''
  const pass = process.env[`${source.envPrefix}_PASSWORD`] ?? ''
  const loginUrl = new URL(config.loginPath ?? '/login', config.baseUrl).toString()
  const body = new URLSearchParams({
    [config.usernameField ?? 'username']: user,
    [config.passwordField ?? 'password']: pass,
    redirect: '/',
  })
  const loginRes = await fetch(loginUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    redirect: 'manual',
  })
  // Sucesso = redirect (303/302) com cookie de sessão; login inválido devolve
  // 401 com a página de login de novo (não uma lista de dados).
  if (loginRes.status < 300 || loginRes.status >= 400) {
    throw new Error(`Login em ${loginUrl} falhou (status ${loginRes.status}) — conferir usuário/senha em ${source.envPrefix}_USER/_PASSWORD`)
  }
  // O servidor manda o cookie de sessão real JUNTO com cookies de limpeza
  // (mesmo nome, valor vazio, de sessões antigas) — só o último valor NÃO
  // vazio de cada nome importa. Sem esse filtro, o valor vazio podia acabar
  // sendo o que sobrava na hora de montar o header e a sessão nunca autentica.
  const porNome = new Map<string, string>()
  for (const raw of loginRes.headers.getSetCookie()) {
    const pair = raw.split(';')[0]
    const idx = pair.indexOf('=')
    if (idx < 0) continue
    const nome = pair.slice(0, idx)
    const valor = pair.slice(idx + 1)
    if (valor) porNome.set(nome, valor)
  }
  if (porNome.size === 0) {
    throw new Error(`Login em ${loginUrl} não devolveu cookie de sessão`)
  }
  return [...porNome.entries()].map(([nome, valor]) => `${nome}=${valor}`).join('; ')
}

export const webserviceConnector: Connector = {
  async fetchRows(source: DataSource, dataset: Dataset, watermark: string | null): Promise<ExternalRow[]> {
    const config = (source.config ?? {}) as {
      baseUrl?: string
      authType?: string
      rowsPath?: string
      loginPath?: string
      usernameField?: string
      passwordField?: string
      connectorMode?: string
    }

    // Omnilink Turbo (Show Tecnologia): fluxo próprio (login → token de 24h
    // no header x-access-token → consulta POST paginada por "parte") — foge
    // demais do modelo "GET + rowsPath" genérico abaixo para caber nele.
    if (config.connectorMode === 'omnilink-turbo') {
      return fetchOmnilinkPosicoes(source, dataset, watermark)
    }

    if (!config.baseUrl) throw new Error(`DataSource ${source.name}: config.baseUrl ausente`)

    const path = dataset.query.replace('{{watermark}}', watermark ? encodeURIComponent(watermark) : '')
    const url = new URL(path, config.baseUrl).toString()

    const headers: Record<string, string> = { Accept: 'application/json' }
    if (config.authType === 'basic') {
      const user = process.env[`${source.envPrefix}_USER`] ?? ''
      const pass = process.env[`${source.envPrefix}_PASSWORD`] ?? ''
      headers.Authorization = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`
    } else if (config.authType === 'bearer') {
      headers.Authorization = `Bearer ${process.env[`${source.envPrefix}_TOKEN`] ?? ''}`
    } else if (config.authType === 'session-login') {
      headers.Cookie = await sessionLoginCookie(source, config)
    }

    const res = await fetch(url, { headers })
    if (!res.ok) throw new Error(`Web service ${url} respondeu ${res.status}`)
    const body = (await res.json()) as unknown

    // rowsPath permite extrair a lista de dentro do envelope (ex.: "data.items")
    let rows: unknown = body
    if (config.rowsPath) {
      for (const part of config.rowsPath.split('.')) {
        rows = (rows as Record<string, unknown>)?.[part]
      }
    }
    if (!Array.isArray(rows)) throw new Error(`Resposta do web service não é uma lista (rowsPath=${config.rowsPath ?? '-'})`)
    return rows as ExternalRow[]
  },
}
