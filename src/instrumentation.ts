// Roda uma vez quando o servidor Next.js sobe (Node runtime). Usado para
// ligar o vigia de pasta de tickets de viagem, se configurado — ver
// src/lib/ocr/folder-watcher.ts. Nunca no Edge runtime (usa fs/prisma, não
// disponíveis lá).
export async function register() {
  if (process.env.NEXT_RUNTIME === 'edge') return
  const { startFolderWatcher } = await import('@/lib/ocr/folder-watcher')
  startFolderWatcher()
}
