import Anthropic from '@anthropic-ai/sdk'
import type { ParsedTicket } from './parse'
import type { OcrLogFn } from './types'

// Haiku (não Sonnet/Opus) — extração de 3 campos de um ticket é uma tarefa
// simples, não precisa do modelo topo de linha (pedido do usuário
// 2026-08-03: "buscar o menor custo viável").
const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001'

const EXTRACT_TOOL = {
  name: 'registrar_dados_ticket',
  description: 'Registra os dados lidos no ticket de pesagem/viagem.',
  input_schema: {
    type: 'object' as const,
    properties: {
      placa: {
        type: ['string', 'null'],
        description: 'Placa do caminhão (formato antigo LLLNNNN ou Mercosul LLLNLNN), ou null se ilegível.',
      },
      pesoAproximadoTon: {
        type: ['number', 'null'],
        description: 'Peso do ticket, convertido para TONELADAS (divida por 1000 se estiver em kg no ticket), ou null se não houver peso legível.',
      },
      dataTicket: {
        type: ['string', 'null'],
        description: 'Data do ticket em formato YYYY-MM-DD, ou null se ilegível.',
      },
    },
    required: ['placa', 'pesoAproximadoTon', 'dataTicket'],
  },
}

/**
 * OCR via IA de visão (Anthropic) — pedido do usuário 2026-08-03 como
 * alternativa ao OCR local, para quando o ticket for manuscrito/rasurado e o
 * Tesseract não conseguir ler. Diferente do Tesseract, lê imagem E PDF
 * diretamente (Claude aceita documento PDF nativamente). A imagem/PDF sai do
 * servidor para a API da Anthropic — só usar este provider com ciência disso.
 */
export async function extractWithAnthropic(
  fileBuffer: Buffer,
  mime: string,
  onLog?: OcrLogFn,
): Promise<(ParsedTicket & { textoBruto: string }) | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY não configurada no .env')

  const client = new Anthropic({ apiKey })
  const base64 = fileBuffer.toString('base64')
  const isPdf = mime === 'application/pdf'

  onLog?.(`Enviando ${isPdf ? 'PDF' : 'imagem'} para a Anthropic (IA de visão)…`, 30)
  const message = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 1024,
    tools: [EXTRACT_TOOL],
    tool_choice: { type: 'tool', name: EXTRACT_TOOL.name },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: isPdf ? 'document' : 'image',
            source: { type: 'base64', media_type: mime as never, data: base64 },
          },
          {
            type: 'text',
            text: 'Este é um ticket de pesagem/viagem de transporte rodoviário. Leia a placa do caminhão, o peso e a data e registre com a ferramenta.',
          },
        ],
      },
    ],
  })

  onLog?.('Resposta recebida, interpretando placa/peso/data…', 90)
  const toolUse = message.content.find((b) => b.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') return null
  const input = toolUse.input as { placa: string | null; pesoAproximadoTon: number | null; dataTicket: string | null }
  const textoBruto = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
  return { placa: input.placa, pesoAproximadoTon: input.pesoAproximadoTon, dataTicket: input.dataTicket, textoBruto }
}
