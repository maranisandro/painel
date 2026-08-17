import { prisma } from '@/lib/prisma'
import { extractWithTesseract } from './tesseract'
import { extractWithAnthropic } from './anthropic'
import { extractWithOpenAI } from './openai'
import type { ParsedTicket } from './parse'
import type { OcrLogFn } from './types'

export const OCR_PROVIDER_PARAM_CODE = 'OCR_PROVIDER'
export type OcrProvider = 'tesseract' | 'anthropic' | 'openai'

const PROVIDER_LABEL: Record<OcrProvider, string> = {
  tesseract: 'Tesseract (local)',
  anthropic: 'IA de visão (Anthropic, Haiku)',
  openai: 'IA de visão (OpenAI, gpt-4o-mini)',
}

export async function getOcrProvider(): Promise<OcrProvider> {
  const param = await prisma.parameter.findUnique({ where: { code: OCR_PROVIDER_PARAM_CODE } })
  const value = param?.valueText
  return value === 'anthropic' || value === 'openai' ? value : 'tesseract'
}

export interface OcrOutcome extends ParsedTicket {
  status: 'reconhecido' | 'falhou'
  textoBruto: string | null
}

/** Reconhecido = os 3 campos vieram preenchidos; falta qualquer um = falhou (cai no fallback manual). */
export async function recognizeTicket(fileBuffer: Buffer, mime: string, onLog?: OcrLogFn): Promise<OcrOutcome> {
  const provider = await getOcrProvider()
  onLog?.(`Motor selecionado: ${PROVIDER_LABEL[provider]}.`, 2)
  try {
    const result =
      provider === 'anthropic'
        ? await extractWithAnthropic(fileBuffer, mime, onLog)
        : provider === 'openai'
          ? await extractWithOpenAI(fileBuffer, mime, onLog)
          : await extractWithTesseract(fileBuffer, mime, onLog)

    if (!result || !result.placa || !result.pesoAproximadoTon || !result.dataTicket) {
      onLog?.(
        `Não achou todos os campos (placa=${result?.placa ?? '—'}, peso=${result?.pesoAproximadoTon ?? '—'}, data=${result?.dataTicket ?? '—'}) — precisa de preenchimento manual.`,
        100,
      )
      return {
        status: 'falhou',
        placa: result?.placa ?? null,
        pesoAproximadoTon: result?.pesoAproximadoTon ?? null,
        dataTicket: result?.dataTicket ?? null,
        textoBruto: result?.textoBruto ?? null,
      }
    }
    onLog?.(`Reconhecido: placa ${result.placa}, ${result.pesoAproximadoTon} t, ${result.dataTicket}.`, 100)
    return { status: 'reconhecido', ...result }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[ocr] falha ao reconhecer ticket', err)
    onLog?.(`Erro no OCR: ${msg}`, 100)
    return { status: 'falhou', placa: null, pesoAproximadoTon: null, dataTicket: null, textoBruto: null }
  }
}
