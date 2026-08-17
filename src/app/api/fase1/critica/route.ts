import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, hasModuleAccess } from '@/lib/authz'
import { getDatasetView } from '@/lib/semantic/dataset-view'
import { prisma } from '@/lib/prisma'
import {
  achadosAnormalidadeCritica,
  achadosHodometroTravado,
  achadosHodometroRegrediu,
  achadosSemAbastecimentoProlongado,
  achadosViagemSemAbastecimento,
  achadosMovimentoSemAbastecimento,
  achadosDesvioRotaGps,
  achadosComparativoViagensReferencia,
  achadosPlacaSemComposicao,
  type AchadoDetectado,
  type PosicaoGps,
} from '@/lib/fase1/critica'
import { getAllTripsEnriched } from '@/lib/fase1/get-trips-simple'

const MODULO = 'fase1_combustivel'
const STATUS_VALIDOS = ['reconhecido', 'encaminhado_origem', 'resolvido']

/**
 * Fase 1 — Crítica ao modelo: pedido do usuário 2026-08-05 ("cada problema
 * deve ter o reconhecimento formal, ou até mesmo ajuste na origem").
 * Recalcula os achados AO VIVO a partir do histórico completo de
 * abastecimento e casa com o status persistido (reconhecido/encaminhado)
 * pela chave estável de cada achado.
 */
export async function GET() {
  const user = await getSessionUser()
  if (!hasModuleAccess(user, 'fase1')) return NextResponse.json({ error: 'acesso negado' }, { status: 403 })

  let abastecimento: Record<string, unknown>[] = []
  let placasComViagem: Record<string, unknown>[] = []
  let placasConhecidas = new Set<string>()
  try {
    const allTrips = await getDatasetView('fase1_vendas_transporte')
    placasComViagem = (allTrips as Record<string, unknown>[]).filter((t) => t['Consolida Transportadora'] === 'Proprio')
    placasConhecidas = new Set(placasComViagem.map((t) => String(t.PLACA ?? '').trim().toUpperCase()))
    const fuelRows = await getDatasetView('fase1_abastecimento')
    abastecimento = fuelRows
      .filter((r) => placasConhecidas.has(String(r.PLACA ?? '').trim().toUpperCase()))
      .map((r) => ({
        PLACA: String(r.PLACA ?? '').trim().toUpperCase(),
        date: String(r.date ?? '').slice(0, 10),
        pedometer: Number(r.pedometer) || 0,
        amount: Number(r.amount) || 0,
        produto: String(r.PRODUTO_ABASTECIMENTO ?? '').trim(),
      }))
  } catch {
    abastecimento = []
  }

  // Rastreamento real (Omnilink) para cruzar com abastecimento e com a rota
  // cadastrada — pedido do usuário 2026-08-05. Integração recente (poucos
  // dias de histórico no início), então a cobertura cresce aos poucos; falha
  // de leitura aqui não pode derrubar os outros achados (combustível segue
  // funcionando sem rastreamento).
  let posicoesGps: PosicaoGps[] = []
  let tripsEnriquecidas: Record<string, unknown>[] = []
  try {
    const posicoes = await prisma.vehiclePosition.findMany({
      where: { placa: { in: [...placasConhecidas] } },
      select: { placa: true, capturedAt: true, latitude: true, longitude: true },
    })
    posicoesGps = posicoes.map((p) => ({
      placa: p.placa,
      capturedAt: p.capturedAt.toISOString(),
      latitude: p.latitude,
      longitude: p.longitude,
    }))
    tripsEnriquecidas = await getAllTripsEnriched()
  } catch {
    posicoesGps = []
    tripsEnriquecidas = []
  }

  const composicoes = await prisma.plateComposition.findMany({ select: { placa: true } })
  const placasComComposicao = new Set(composicoes.map((c) => c.placa.trim().toUpperCase()))

  const detectados: AchadoDetectado[] = [
    ...achadosAnormalidadeCritica(abastecimento, placasConhecidas, 2),
    ...achadosHodometroTravado(abastecimento, placasConhecidas),
    ...achadosHodometroRegrediu(abastecimento, placasConhecidas),
    ...achadosSemAbastecimentoProlongado(abastecimento, placasConhecidas),
    ...achadosViagemSemAbastecimento(placasComViagem, abastecimento, placasConhecidas),
    ...achadosMovimentoSemAbastecimento(posicoesGps, abastecimento, placasConhecidas),
    ...achadosDesvioRotaGps(tripsEnriquecidas, posicoesGps),
    ...achadosComparativoViagensReferencia(placasComViagem),
    ...achadosPlacaSemComposicao(placasComViagem, placasComComposicao),
  ]

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
  if (!hasModuleAccess(user, 'fase1')) return NextResponse.json({ error: 'acesso negado' }, { status: 403 })

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
