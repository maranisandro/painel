import OpenAI from 'openai'
import type { ChatCompletion } from 'openai/resources/chat/completions'
import type { ParsedTicket } from './parse'
import type { OcrLogFn } from './types'

// Modelo mini/econômico — extração de 3 campos de um ticket não precisa do
// modelo topo de linha (pedido do usuário 2026-08-03: "buscar o menor custo
// viável"). Só lê imagem (PDF exigiria a Files API da OpenAI, fora do
// escopo inicial — mesma limitação do Tesseract).
const OPENAI_MODEL = 'gpt-4o-mini'

const EXTRACT_TOOL = {
  type: 'function' as const,
  function: {
    name: 'registrar_dados_ticket',
    description: 'Registra os dados lidos no ticket de pesagem/viagem.',
    parameters: {
      type: 'object',
      properties: {
        placa: {
          type: ['string', 'null'],
          description: 'Placa do caminhão (formato antigo LLLNNNN ou Mercosul LLLNLNN), ou null se ilegível.',
        },
        pesoAproximadoTon: {
          type: ['number', 'null'],
          description: 'Peso do ticket, convertido para TONELADAS (divida por 1000 se estiver em kg), ou null se não houver peso legível.',
        },
        dataTicket: {
          type: ['string', 'null'],
          description: 'Data do ticket em formato YYYY-MM-DD, ou null se ilegível.',
        },
      },
      required: ['placa', 'pesoAproximadoTon', 'dataTicket'],
    },
  },
}

/**
 * OCR via IA de visão da OpenAI (ChatGPT) — segunda alternativa de IA além
 * da Anthropic, pedido do usuário 2026-08-03. Só imagem (não PDF).
 */
export async function extractWithOpenAI(
  fileBuffer: Buffer,
  mime: string,
  onLog?: OcrLogFn,
): Promise<(ParsedTicket & { textoBruto: string }) | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY não configurada no .env')
  if (!mime.startsWith('image/')) {
    onLog?.('OpenAI (via chat completions) só lê imagem, não PDF — pulando OCR.', 100)
    return null
  }

  const client = new OpenAI({ apiKey })
  const dataUrl = `data:${mime};base64,${fileBuffer.toString('base64')}`

  onLog?.(`Enviando imagem para a OpenAI (${OPENAI_MODEL})…`, 30)
  // Retry com backoff em 429 (rate limit) — achado real 2026-08-20: reprocessar
  // muitos tickets de uma vez (210+) esgota o limite de tokens/minuto da
  // organização, e cada chamada de imagem consome bastante token. Sem retry,
  // todo o lote além do limite falhava na hora, exigindo reprocessar de novo
  // manualmente. Usa o header `retry-after` da própria OpenAI quando vem.
  const MAX_TENTATIVAS = 3
  let ultimoErro: unknown
  let completion: ChatCompletion | null = null
  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    try {
      completion = await client.chat.completions.create({
        model: OPENAI_MODEL,
        tools: [EXTRACT_TOOL],
        tool_choice: { type: 'function', function: { name: EXTRACT_TOOL.function.name } },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Este é um ticket de pesagem/viagem de transporte rodoviário. Leia a placa do caminhão, o peso e a data e registre com a ferramenta.' },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
      })
      break
    } catch (err) {
      ultimoErro = err
      const status = (err as { status?: number })?.status
      if (status !== 429 || tentativa === MAX_TENTATIVAS) throw err
      const retryAfterMs = Number((err as { headers?: Headers })?.headers?.get?.('retry-after-ms')) || 5000
      onLog?.(`Rate limit da OpenAI — tentativa ${tentativa}/${MAX_TENTATIVAS}, aguardando ${Math.round(retryAfterMs / 1000)}s…`, 30)
      await new Promise((resolve) => setTimeout(resolve, retryAfterMs))
    }
  }
  if (!completion) throw ultimoErro instanceof Error ? ultimoErro : new Error('Falha desconhecida na chamada à OpenAI')

  onLog?.('Resposta recebida, interpretando placa/peso/data…', 90)
  const call = completion.choices[0]?.message.tool_calls?.[0]
  if (!call || call.type !== 'function') return null
  const input = JSON.parse(call.function.arguments) as {
    placa: string | null
    pesoAproximadoTon: number | null
    dataTicket: string | null
  }
  return {
    placa: input.placa,
    pesoAproximadoTon: input.pesoAproximadoTon,
    dataTicket: input.dataTicket,
    textoBruto: completion.choices[0]?.message.content ?? '',
  }
}
