import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, hasModuleAccess } from '@/lib/authz'
import { prisma } from '@/lib/prisma'
import { diaBrasilDe, horaBrasilDe, diaAnteriorStr } from '@/lib/horario-brasil'
import { horasRodandoGps } from '@/lib/fase1/disponibilidade'
import { getAllTripsBasic } from '@/lib/fase1/get-trips-simple'

function normPlaca(v: unknown): string {
  return String(v ?? '').trim().toUpperCase()
}

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

  // Motorista — pedido do usuário 2026-08-21: "trazer o nome do motorista,
  // vamos utilizar o mesmo motorista que consta na NF no período em que
  // rodou a noite". Não tem motorista no GPS bruto (VehiclePosition) — só
  // no dataset de viagens/NF (fase1_vendas_transporte, campo MOTORISTA).
  //
  // A DATASAIDA de uma NF é quando a viagem foi DESPACHADA (carregada), não
  // necessariamente a hora em que o caminhão está de fato rodando à noite —
  // testado ao vivo: uma placa que rodou GPS de 20/08 19h a 21/08 04h tinha
  // sua NF mais próxima despachada em 19/08 13h30 (tarde do dia anterior),
  // nenhuma NF caindo dentro da própria janela 19h-04h. Por isso o motorista
  // usado é o da NF DESPACHADA MAIS RECENTEMENTE até o FIM daquela madrugada
  // (mesma lógica de "vigência" do resolver de composição de placa em
  // src/lib/fase1/composition.ts: vale o registro mais recente com data
  // <= a data de referência) — reflete quem estava "de posse" do caminhão
  // até aquele momento, não exige que a NF tenha saído durante a madrugada.
  // Busca de viagens é só um ENRIQUECIMENTO (nome do motorista) — uma falha
  // aqui (dataset indisponível, registro corrompido) nunca pode derrubar as
  // linhas de "rodando à noite" em si. Se der erro, segue com o mapa vazio:
  // toda placa cai no "sem NF na janela" (mesmo comportamento de antes da
  // coluna Motorista existir), em vez de a rota inteira retornar 500.
  const viagensPorPlaca = new Map<string, { dataSaida: number; motorista: string }[]>()
  try {
    const trips = await getAllTripsBasic()
    for (const t of trips) {
      const placa = normPlaca(t.PLACA)
      const dataSaida = t.DATASAIDA
      // .getTime() em vez de .toISOString(): um Date inválido (registro com
      // DATASAIDA corrompida) faz .toISOString() LANÇAR RangeError e derrubar
      // a rota inteira — .getTime() só retorna NaN, que o guard abaixo pula.
      const dataMs = dataSaida instanceof Date ? dataSaida.getTime() : Date.parse(String(dataSaida ?? ''))
      const motorista = String(t.MOTORISTA ?? '').trim()
      if (!placa || Number.isNaN(dataMs) || !motorista) continue
      const lista = viagensPorPlaca.get(placa) ?? []
      lista.push({ dataSaida: dataMs, motorista })
      viagensPorPlaca.set(placa, lista)
    }
    for (const lista of viagensPorPlaca.values()) lista.sort((a, b) => a.dataSaida - b.dataSaida)
  } catch (err) {
    console.error('[noite-rodando] falha ao buscar motoristas (viagens) — seguindo sem essa info', err)
    viagensPorPlaca.clear()
  }

  /** Fim da janela 19h-04h de uma "noite" (YYYY-MM-DD) — 04h do dia seguinte, em horário de Brasília (UTC-3, sem DST). */
  function fimDaNoite(noite: string): number {
    return Date.parse(`${noite}T04:00:00-03:00`) + 24 * 3_600_000
  }
  function motoristasAteFimDaNoite(placa: string, noite: string): string[] {
    const lista = viagensPorPlaca.get(placa)
    if (!lista || lista.length === 0) return []
    const limite = fimDaNoite(noite)
    let ultima: { dataSaida: number; motorista: string } | null = null
    for (const v of lista) {
      if (v.dataSaida > limite) break
      ultima = v
    }
    return ultima ? [ultima.motorista] : []
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
    motoristas: string[]
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
      motoristas: motoristasAteFimDaNoite(grupo[0].placa, grupo[0].noite),
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
