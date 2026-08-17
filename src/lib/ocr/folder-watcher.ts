import fs from 'node:fs/promises'
import path from 'node:path'
import { ingestTicketFile } from './ingest'

// Vigia de pasta (pedido do usuário 2026-08-03: "pensar na opção de ficar
// lendo uma pasta que possamos apontar e o sistema ler esta pasta de tempos
// em tempos") — pasta desligada por padrão (TICKET_WATCH_FOLDER vazio no
// .env). Arquivo processado é movido para uma subpasta "processados" (não
// apaga o original) para não ser lido de novo na próxima varredura.
const AUTOR_VIGIA = { userId: null, userName: 'Vigia de pasta automático' }

const EXT_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
}

let scanning = false
let intervalHandle: ReturnType<typeof setInterval> | null = null

async function scanOnce(folder: string): Promise<void> {
  if (scanning) return
  scanning = true
  try {
    const processadosDir = path.join(folder, 'processados')
    await fs.mkdir(processadosDir, { recursive: true })

    const entradas = await fs.readdir(folder, { withFileTypes: true })
    const arquivos = entradas.filter((e) => e.isFile() && EXT_MIME[path.extname(e.name).toLowerCase()])
    if (arquivos.length === 0) return

    console.log(`[vigia-pasta] ${arquivos.length} arquivo(s) novo(s) em ${folder}`)
    for (const entrada of arquivos) {
      const caminho = path.join(folder, entrada.name)
      const mime = EXT_MIME[path.extname(entrada.name).toLowerCase()]
      try {
        const buffer = await fs.readFile(caminho)
        await ingestTicketFile(buffer, entrada.name, mime, AUTOR_VIGIA)
        await fs.rename(caminho, path.join(processadosDir, entrada.name))
      } catch (err) {
        console.error(`[vigia-pasta] falha ao processar "${entrada.name}"`, err)
      }
    }
  } catch (err) {
    console.error('[vigia-pasta] falha ao varrer a pasta', err)
  } finally {
    scanning = false
  }
}

/** Chamado uma vez no boot do servidor (src/instrumentation.ts). Sem pasta configurada, não faz nada. */
export function startFolderWatcher(): void {
  const folder = process.env.TICKET_WATCH_FOLDER?.trim()
  if (!folder) return
  const minutos = Number(process.env.TICKET_WATCH_INTERVAL_MINUTES) || 5

  console.log(`[vigia-pasta] ativado em "${folder}", a cada ${minutos} min`)
  void scanOnce(folder)
  intervalHandle = setInterval(() => void scanOnce(folder), minutos * 60_000)
}

export function stopFolderWatcher(): void {
  if (intervalHandle) clearInterval(intervalHandle)
  intervalHandle = null
}
