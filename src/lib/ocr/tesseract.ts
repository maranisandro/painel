import { createWorker } from 'tesseract.js'
import { parseTicketText, type ParsedTicket } from './parse'
import type { OcrLogFn } from './types'

/**
 * OCR local (sem sair da rede da empresa) via tesseract.js. Só funciona em
 * imagem — PDF exigiria rasterizar a primeira página antes, fora do escopo
 * inicial (pedido do usuário 2026-08-03: "vamos iniciar no tradicional").
 * Pacote de idioma "por" baixa na primeira execução (precisa de internet
 * uma única vez; fica em cache depois) — por isso o primeiro ticket costuma
 * demorar mais que os seguintes.
 */
export async function extractWithTesseract(
  fileBuffer: Buffer,
  mime: string,
  onLog?: OcrLogFn,
): Promise<(ParsedTicket & { textoBruto: string }) | null> {
  if (!mime.startsWith('image/')) {
    onLog?.('Tesseract só lê imagem, não PDF — pulando OCR.', 100)
    return null
  }

  let ultimoStatus = ''
  onLog?.('Iniciando worker Tesseract (idioma português)…', 5)
  const worker = await createWorker('por', 1, {
    logger: (m) => {
      if (!onLog) return
      // tesseract.js manda muitos eventos de progresso (0 a 1) — só loga
      // quando muda de etapa, pra não encher o log de linha repetida.
      // Pesa a etapa "recognizing text" como 10%-90% do total: as etapas
      // anteriores (carregar/inicializar) são rápidas perto dela.
      const chave = `${m.status}:${Math.round((m.progress ?? 0) * 4)}`
      if (chave === ultimoStatus) return
      ultimoStatus = chave
      const progresso =
        m.status === 'recognizing text' ? 10 + Math.round((m.progress ?? 0) * 80) : 8
      onLog(`${m.status} (${Math.round((m.progress ?? 0) * 100)}%)`, progresso)
    },
  })
  try {
    const { data } = await worker.recognize(fileBuffer)
    const texto = data.text ?? ''
    onLog?.(`Texto extraído (${texto.length} caracteres) — interpretando placa/peso/data…`, 95)
    return { ...parseTicketText(texto), textoBruto: texto }
  } finally {
    await worker.terminate()
  }
}
