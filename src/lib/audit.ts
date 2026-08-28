import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { prisma } from './prisma'

interface AuditEntry {
  userId?: string | null
  userName?: string | null
  action: string
  entity: string
  entityId?: string | null
  details?: unknown
}

const FALLBACK_DIR = path.join(process.cwd(), 'logs')
const FALLBACK_FILE = path.join(FALLBACK_DIR, 'audit-fallback.jsonl')

/**
 * Grava a entrada que não pôde ir para o banco num arquivo local, uma linha
 * JSON por entrada — S9 (revisão de segurança 2026-07-25): "auditoria não
 * garantida, falha só loga no console", invisível em produção sem
 * agregador de log. Isto não é uma garantia forte (arquivo local, sem
 * réplica), mas já impede a perda silenciosa que existia antes.
 */
async function writeFallback(entry: AuditEntry, error: unknown) {
  try {
    await mkdir(FALLBACK_DIR, { recursive: true })
    const line = JSON.stringify({
      ...entry,
      capturedAt: new Date().toISOString(),
      dbError: error instanceof Error ? error.message : String(error),
    })
    await appendFile(FALLBACK_FILE, line + '\n', 'utf8')
  } catch (fallbackErr) {
    // Se nem o fallback em disco funcionar, não há mais nada a fazer além de logar.
    console.error('[audit] falha ao gravar fallback em disco', fallbackErr)
  }
}

/** Grava trilha de auditoria. Nunca lança — falha de auditoria não pode derrubar a operação. */
export async function logAudit(entry: AuditEntry) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: entry.userId ?? null,
        userName: entry.userName ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        details: entry.details === undefined ? undefined : (entry.details as object),
      },
    })
  } catch (err) {
    console.error('[audit] falha ao gravar auditoria', err)
    await writeFallback(entry, err)
  }
}
