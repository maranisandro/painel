import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, hasModuleAccess } from '@/lib/authz'
import { prisma } from '@/lib/prisma'
import { findContainingLocation, agruparPorProximidade, haversineKm } from '@/lib/geo'
import { diaBrasilDe, horaBrasilDe, diaAnteriorStr } from '@/lib/horario-brasil'

/**
 * Identifica onde cada placa fica parada durante a noite — pedido do usuário
 * 2026-08-17: "criar uma aba onde conseguimos identificar os locais que os
 * caminhões estão ficando parados a noite". Janela noturna: 21h-04h59 no
 * horário de Brasília (a posição das 2h de um dia pertence à noite que
 * começou na véspera). Não depende de Local cadastrado — funciona por GPS
 * bruto (VehiclePosition), casando com um Local existente quando houver.
 */

const JANELA_INICIO_HORA = 21
const JANELA_FIM_HORA = 5 // exclusivo — 5h já é fora da janela
const RAIO_PARADO_METROS = 300 // dispersão máxima das posições da noite para considerar "parado" (não em trânsito)
const RAIO_CLUSTER_METROS = 300 // mesmo raio usado para agrupar locais não identificados no resumo

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

  const [posicoes, locations] = await Promise.all([
    prisma.vehiclePosition.findMany({
      where: {
        capturedAt: { gte: fromDate, lte: toDate },
        ...(placaFiltro ? { placa: placaFiltro } : {}),
      },
      select: { placa: true, latitude: true, longitude: true, capturedAt: true },
      orderBy: { capturedAt: 'asc' },
    }),
    prisma.location.findMany({
      where: { active: true },
      select: { id: true, name: true, type: true, latitude: true, longitude: true, raioMetros: true, polygon: true },
    }),
  ])
  const locationsGeofence = locations.map((l) => ({
    ...l,
    polygon: (l.polygon as { lat: number; lng: number }[] | null) ?? null,
  }))

  const porGrupo = new Map<string, { placa: string; noite: string; lat: number; lng: number; capturedAt: string }[]>()
  for (const p of posicoes) {
    const dia = diaBrasilDe(p.capturedAt)
    const hora = horaBrasilDe(p.capturedAt)
    const noite = classificarNoite(dia, hora)
    if (!noite) continue
    const chave = `${p.placa}|${noite}`
    const lista = porGrupo.get(chave) ?? []
    lista.push({ placa: p.placa, noite, lat: p.latitude, lng: p.longitude, capturedAt: p.capturedAt.toISOString() })
    porGrupo.set(chave, lista)
  }

  const pernoites: {
    placa: string
    noite: string
    latitude: number
    longitude: number
    localNome: string | null
    localTipo: string | null
    nPosicoes: number
    primeiraHora: string
    ultimaHora: string
  }[] = []
  for (const grupo of porGrupo.values()) {
    if (grupo.length < 2) continue // 1 leitura isolada não confirma pernoite (pode ser passagem)
    const latitude = grupo.reduce((s, p) => s + p.lat, 0) / grupo.length
    const longitude = grupo.reduce((s, p) => s + p.lng, 0) / grupo.length
    const dispersaoMaxima = Math.max(
      ...grupo.map((p) => haversineKm({ lat: latitude, lng: longitude }, { lat: p.lat, lng: p.lng }) * 1000),
    )
    if (dispersaoMaxima > RAIO_PARADO_METROS) continue // moveu-se durante a janela — não ficou parado
    const local = findContainingLocation({ lat: latitude, lng: longitude }, locationsGeofence)
    pernoites.push({
      placa: grupo[0].placa,
      noite: grupo[0].noite,
      latitude,
      longitude,
      localNome: local?.name ?? null,
      localTipo: local?.type ?? null,
      nPosicoes: grupo.length,
      primeiraHora: grupo[0].capturedAt,
      ultimaHora: grupo[grupo.length - 1].capturedAt,
    })
  }
  pernoites.sort((a, b) => b.noite.localeCompare(a.noite) || a.placa.localeCompare(b.placa))

  // Resumo: agrupa por Local conhecido (chave = id) ou por cluster de
  // coordenada para os pernoites sem Local cadastrado — responde
  // diretamente "quais são os locais mais frequentes de pernoite".
  const comLocal = pernoites.filter((p) => p.localNome)
  const semLocal = pernoites.filter((p) => !p.localNome)
  const porLocalNome = new Map<string, { nome: string; tipo: string | null; noites: Set<string>; placas: Set<string> }>()
  for (const p of comLocal) {
    const entry = porLocalNome.get(p.localNome!) ?? { nome: p.localNome!, tipo: p.localTipo, noites: new Set(), placas: new Set() }
    entry.noites.add(`${p.placa}|${p.noite}`)
    entry.placas.add(p.placa)
    porLocalNome.set(p.localNome!, entry)
  }
  const resumoComLocal = [...porLocalNome.values()].map((e) => ({
    nome: e.nome,
    tipo: e.tipo,
    noites: e.noites.size,
    placas: [...e.placas].sort(),
  }))
  const resumoSemLocal = agruparPorProximidade(
    semLocal.map((p) => ({ lat: p.latitude, lng: p.longitude, ref: p })),
    RAIO_CLUSTER_METROS,
  ).map((itens) => {
    const latitude = itens.reduce((s, i) => s + i.lat, 0) / itens.length
    const longitude = itens.reduce((s, i) => s + i.lng, 0) / itens.length
    const noites = new Set(itens.map((i) => `${i.ref.placa}|${i.ref.noite}`))
    const placas = new Set(itens.map((i) => i.ref.placa))
    return {
      nome: `Local não identificado (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`,
      tipo: null as string | null,
      noites: noites.size,
      placas: [...placas].sort(),
      latitude,
      longitude,
    }
  })
  const resumo = [...resumoComLocal, ...resumoSemLocal].sort((a, b) => b.noites - a.noites)

  return NextResponse.json({ pernoites, resumo })
}
