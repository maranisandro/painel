import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireResourceViewer, requireResourceEditor, badRequest } from '@/lib/api-helpers'
import { OCR_PROVIDER_PARAM_CODE, getOcrProvider } from '@/lib/ocr'

// Só o provider é configurável por aqui — as chaves de API dos provedores de
// IA vivem só no .env (ANTHROPIC_API_KEY / OPENAI_API_KEY), nunca são
// lidas/escritas por uma tela web (mesmo padrão de credenciais do painel).
export async function GET() {
  const auth = await requireResourceViewer('tickets_viagem')
  if ('error' in auth) return auth.error
  const provider = await getOcrProvider()
  return NextResponse.json({
    provider,
    anthropicConfigurado: !!process.env.ANTHROPIC_API_KEY,
    openaiConfigurado: !!process.env.OPENAI_API_KEY,
  })
}

const schema = z.object({ provider: z.enum(['tesseract', 'anthropic', 'openai']) })

export async function PUT(req: NextRequest) {
  const auth = await requireResourceEditor('tickets_viagem')
  if ('error' in auth) return auth.error
  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return badRequest(parsed.error.issues.map((i) => i.message).join('; '))

  await prisma.parameter.upsert({
    where: { code: OCR_PROVIDER_PARAM_CODE },
    update: { valueText: parsed.data.provider },
    create: {
      code: OCR_PROVIDER_PARAM_CODE,
      name: 'Motor de OCR dos tickets de viagem',
      description: 'tesseract (local) ou anthropic (IA de visão, precisa de ANTHROPIC_API_KEY no .env)',
      valueText: parsed.data.provider,
    },
  })
  return NextResponse.json({ provider: parsed.data.provider })
}
