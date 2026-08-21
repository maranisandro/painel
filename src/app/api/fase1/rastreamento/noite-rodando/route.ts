import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, hasModuleAccess } from '@/lib/authz'
import { prisma } from '@/lib/prisma'
import { diaBrasilDe, horaBrasilDe, diaAnteriorStr } from '@/lib/horario-brasil'
import { horasRodandoGps } from '@/lib/fase1/disponibilidade'

/**
 * Identifica placas em deslocamento durante a madrugada — pedido do usuário
 * 2026-08-21: "criar uma aba em rastreamento onde mostra caminhões que estão
 * rodando entre 19:00 e 4:00 (noite e madrugada), exemplo 20/08 19:00 até
 * 21/08 04:00 veículo deslocando". Janela: 19h-03h59 no horário de Brasília
 * (mesma ideia de virada de noite da rota de pernoite, só que aqui o sinal é
 * "rodando" — velocidade acima do limiar — em vez de "parado"). Não depende
 * de Local cadastrado — funciona direto do GPS bruto (VehiclePosition).
 */

const JANELA_INICIO_HORA = 19
const JANELA_FIM_HORA = 4 // exclusivo — 4h já é fora da janela
// Abaixo disso é ruído de leitura isolada (1-2 posições com velocidade
// momentânea), não deslocamento real na madrugada.
const HORAS_MINIMAS_RODANDO = 0.25

function classificarNoite(dia: string, hora: number): string | null {
  if (hora >= JANELA_INICIO_HORA) return dia
  if (hora < JANELA_FIM_HORA) return diaAnteriorStr(dia)
  return null
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser()
  if (!hasModuleAccess(user, 'fase1')) return NextResponse.json({ error: 'acesso negado' }, { status: 403 })

  const from = req.nextUrl.searchParams.get('from')
  const to = req.nextUrl.searchParams.get('to')
  const placaFiltro = req.nextUrl.searchParams.get('placa')?.trim().toUpperCase()

  const hoje = new Date()
  const fromDate = from ? new Date(`${from}T00:00:00`) : new Date(hoje.getTime() - 7 * 86_400_000)
  const toDate = to ? new Date(`${to}T23:59:59`) : hoje

  const posicoes = await prisma.vehiclePosition.findMany({
    where: {
      capturedAt: { gte: fromDate, lte: toDate },
      ...(placaFiltro ? { placa: placaFiltro } : {}),
    },
    select: { placa: true, latitude: true, longitude: true, capturedAt: true, speedKmh: true, localizacao: true },
    orderBy: { capturedAt: 'asc' },
  })

  const porGrupo = new Map<
    string,
    { placa: string; noite: string; capturedAt: string; speedKmh: number | null; latitude: number; longitude: number; localizacao: string | null }[]
  >()
  for (const p of posicoes) {
    const dia = diaBrasilDe(p.capturedAt)
    const hora = horaBrasilDe(p.capturedAt)
    const noite = classificarNoite(dia, hora)
    if (!noite) continue
    const chave = `${p.placa}|${noite}`
    const lista = porGrupo.get(chave) ?? []
    lista.push({
      placa: p.placa,
      noite,
      capturedAt: p.capturedAt.toISOString(),
      speedKmh: p.speedKmh,
      latitude: p.latitude,
      longitude: p.longitude,
      localizacao: p.localizacao,
    })
    porGrupo.set(chave, lista)
  }

  const rodandoNoite: {
    placa: string
    noite: string
    horasRodando: number
    nPosicoes: number
    primeiraHora: string
    ultimaHora: string
    localizacaoInicio: string | null
    localizacaoFim: string | null
  }[] = []
  for (const grupo of porGrupo.values()) {
    if (grupo.length < 2) continue // 1 leitura isolada não confirma deslocamento
    const horasRodando = horasRodandoGps(grupo)
    if (horasRodando < HORAS_MINIMAS_RODANDO) continue
    rodandoNoite.push({
      placa: grupo[0].placa,
      noite: grupo[0].noite,
      horasRodando,
      nPosicoes: grupo.length,
      primeiraHora: grupo[0].capturedAt,
      ultimaHora: grupo[grupo.length - 1].capturedAt,
      localizacaoInicio: grupo[0].localizacao,
      localizacaoFim: grupo[grupo.length - 1].localizacao,
    })
  }
  rodandoNoite.sort((a, b) => b.noite.localeCompare(a.noite) || b.horasRodando - a.horasRodando)

  // Resumo por noite — quantas placas estavam rodando naquela madrugada.
  const porNoite = new Map<string, number>()
  for (const r of rodandoNoite) porNoite.set(r.noite, (porNoite.get(r.noite) ?? 0) + 1)
  const resumo = [...porNoite.entries()]
    .map(([noite, placas]) => ({ noite, placas }))
    .sort((a, b) => b.noite.localeCompare(a.noite))

  return NextResponse.json({ rodandoNoite, resumo })
}
