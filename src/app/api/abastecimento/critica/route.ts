import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, hasModuleAccess } from '@/lib/authz'
import { getDatasetView } from '@/lib/semantic/dataset-view'
import { prisma } from '@/lib/prisma'
import { achadosAbastecimento } from '@/lib/abastecimento/critica'

const MODULO = 'abastecimento'
const STATUS_VALIDOS = ['reconhecido', 'encaminhado_origem', 'resolvido']

/**
 * Crítica ao modelo do módulo Abastecimento — mesmo mecanismo genérico já
 * usado na Fase 1 (`CriticaModeloAchado`, achados recalculados ao vivo,
 * reconhecimento formal persistido pela chave estável), só que sobre o
 * universo inteiro de equipamentos, não só a frota de transporte.
 */
export async function GET() {
  const user = await getSessionUser()
  if (!hasModuleAccess(user, 'abastecimento')) return NextResponse.json({ error: 'acesso negado' }, { status: 403 })

  const fuelRows = await getDatasetView('fase1_abastecimento')
  const abastecimento = fuelRows.map((r) => ({
    PLACA: String(r.PLACA ?? '').trim().toUpperCase(),
    date: String(r.date ?? '').slice(0, 10),
    pedometer: Number(r.pedometer) || 0,
    amount: Number(r.amount) || 0,
    produto: String(r.PRODUTO_ABASTECIMENTO ?? '').trim(),
  }))
  const equipamentosConhecidos = new Set(abastecimento.map((r) => r.PLACA).filter(Boolean))

  const detectados = achadosAbastecimento(abastecimento, equipamentosConhecidos)

  const registros = await prisma.criticaModeloAchado.findMany({ where: { modulo: MODULO } })
  const registroPorChave = new Map(registros.map((r) => [r.chave, r]))

  const achados = detectados.map((a) => {
    const registro = registroPorChave.get(a.chave)
    return {
      ...a,
      status: registro?.status ?? 'aberto',
      reconhecidoPor: registro?.reconhecidoPor ?? null,
      reconhecidoEm: registro?.reconhecidoEm?.toISOString() ?? null,
      motivo: registro?.motivo ?? null,
    }
  })

  return NextResponse.json({
    achados: achados.sort((a, b) => (a.status === 'aberto' ? -1 : 1) - (b.status === 'aberto' ? -1 : 1)),
    totalAberto: achados.filter((a) => a.status === 'aberto').length,
  })
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!hasModuleAccess(user, 'abastecimento')) return NextResponse.json({ error: 'acesso negado' }, { status: 403 })

  const body = await req.json()
  const chave = String(body.chave ?? '').trim()
  const categoria = String(body.categoria ?? '').trim()
  const descricao = String(body.descricao ?? '').trim()
  const status = String(body.status ?? '').trim()
  const motivo = String(body.motivo ?? '').trim()
  if (!chave || !categoria) return NextResponse.json({ error: 'chave/categoria obrigatórios' }, { status: 400 })
  if (!STATUS_VALIDOS.includes(status)) return NextResponse.json({ error: 'status inválido' }, { status: 400 })
  if (!motivo) return NextResponse.json({ error: 'motivo obrigatório para reconhecer ou encaminhar um achado' }, { status: 400 })

  const registro = await prisma.criticaModeloAchado.upsert({
    where: { modulo_chave: { modulo: MODULO, chave } },
    update: { status, motivo, descricao, reconhecidoPor: user?.email ?? null, reconhecidoEm: new Date() },
    create: {
      modulo: MODULO,
      chave,
      categoria,
      descricao,
      status,
      motivo,
      reconhecidoPor: user?.email ?? null,
      reconhecidoEm: new Date(),
    },
  })
  return NextResponse.json({ registro })
}
