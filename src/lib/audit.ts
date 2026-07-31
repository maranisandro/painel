import { prisma } from './prisma'

interface AuditEntry {
  userId?: string | null
  userName?: string | null
  action: string
  entity: string
  entityId?: string | null
  details?: unknown
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
  }
}
