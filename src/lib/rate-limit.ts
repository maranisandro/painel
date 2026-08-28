/**
 * Rate limiter em memória, por chave (ex.: e-mail normalizado). Suficiente
 * porque o app roda como processo único (sem múltiplas instâncias atrás de
 * load balancer) — ver [[project_paineis_producao]]. Se isso mudar, precisa
 * virar um contador compartilhado (Redis, etc.).
 */
interface Attempt {
  count: number
  firstAttemptAt: number
}

const attempts = new Map<string, Attempt>()

const MAX_ATTEMPTS = 5
const WINDOW_MS = 15 * 60 * 1000

export function isRateLimited(key: string): boolean {
  const entry = attempts.get(key)
  if (!entry) return false
  if (Date.now() - entry.firstAttemptAt > WINDOW_MS) {
    attempts.delete(key)
    return false
  }
  return entry.count >= MAX_ATTEMPTS
}

export function recordFailedAttempt(key: string): void {
  const entry = attempts.get(key)
  if (!entry || Date.now() - entry.firstAttemptAt > WINDOW_MS) {
    attempts.set(key, { count: 1, firstAttemptAt: Date.now() })
    return
  }
  entry.count += 1
}

export function clearAttempts(key: string): void {
  attempts.delete(key)
}
