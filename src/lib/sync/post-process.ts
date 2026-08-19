import { prisma } from '@/lib/prisma'
import type { ExternalRow } from './types'
import { parseLatLog, parseVelocidadeSentido } from './connectors/omnilink'
import { findContainingLocation, type GeofenceLocation } from '@/lib/geo'

/**
 * Depois de sincronizar `fase1_custos_transporte`, transforma o bloco
 * totais.porMes (cada linha: {mes, chave, valor}) em Parameter
 * `CUSTO_MES_<ano><mês>` — pedido do usuário 2026-07-30.
 *  - `chave` vem como "02/fev" — os 2 primeiros dígitos são o mês.
 *  - Ano fixo em 2026 por enquanto: a API não distingue ano nenhum, o
 *    usuário vai pedir para considerar o ano quando isso mudar.
 *  - `valor` vem negativo (convenção contábil da Controladoria) — vira
 *    positivo (convenção do painel, ex. CUSTO_TOTAL_MES).
 *  - Só cria/atualiza meses com valor <> 0 (meses zerados não têm
 *    lançamento ainda e não devem virar parâmetro fantasma).
 *  - Nome do parâmetro carrega a data/hora da atualização, já que a tela de
 *    Parâmetros não mostra `updatedAt`.
 */
const ANO_ATUAL = '2026'

export async function processCustosTransporteRodoviario(rows: ExternalRow[]): Promise<void> {
  const atualizadoEm = new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  })
  for (const row of rows) {
    const chave = String(row.chave ?? '').trim() // ex.: "02/fev"
    const mesAbrev = String(row.mes ?? '').trim() // ex.: "FEV"
    const mesNum = chave.split('/')[0]
    const valor = Number(row.valor) || 0
    if (valor === 0 || !/^\d{2}$/.test(mesNum)) continue

    const code = `CUSTO_MES_${ANO_ATUAL}${mesNum}`
    const valorPositivo = Math.abs(valor)
    const name = `Custo transporte rodoviário ${mesNum}/${ANO_ATUAL} (${mesAbrev}) — atualizado ${atualizadoEm}`
    const description = 'Custo real (Caderno Gerencial, API Controladoria) — sincronizado automaticamente a cada hora.'

    await prisma.parameter.upsert({
      where: { code },
      update: { name, description, valueNumber: valorPositivo },
      create: { code, name, description, valueNumber: valorPositivo },
    })
  }
}

// Retenção de histórico de posições — pedido do usuário 2026-08-03: "vamos
// trabalhar com um histórico de 60 dias e limpar o log de viagem das viagens
// com mais de 60 dias". Roda a cada sync (mesmo gatilho periódico que já
// existe), não precisa de um agendador à parte.
const RETENCAO_DIAS = 60

async function purgeOldVehiclePositions(): Promise<void> {
  const limite = new Date(Date.now() - RETENCAO_DIAS * 86_400_000)
  const { count } = await prisma.vehiclePosition.deleteMany({ where: { capturedAt: { lt: limite } } })
  if (count > 0) console.log(`[omnilink] limpeza: ${count} posição(ões) com mais de ${RETENCAO_DIAS} dias removida(s)`)
}

export const VELOCIDADE_MAXIMA_PARAM_CODE = 'VELOCIDADE_MAXIMA_KMH'
const VELOCIDADE_MAXIMA_PADRAO_KMH = 100 // usado só se o parâmetro ainda não foi cadastrado

async function getLimiteVelocidade(): Promise<number> {
  const param = await prisma.parameter.findUnique({ where: { code: VELOCIDADE_MAXIMA_PARAM_CODE } })
  const valor = param?.valueNumber != null ? Number(param.valueNumber) : null
  return valor && valor > 0 ? valor : VELOCIDADE_MAXIMA_PADRAO_KMH
}

/**
 * Registra/atualiza o episódio de excesso de velocidade da placa — pedido do
 * usuário 2026-08-03: velocidade acima do limite dos Parâmetros precisa de
 * reconhecimento formal do operador, não pode só "aparecer no mapa e passar
 * batido". Um alerta ainda não reconhecido é ATUALIZADO (pico de velocidade e
 * local mais recentes) em vez de duplicado — o rastreador manda posição a
 * cada poucos segundos, criar um alerta por leitura acima do limite
 * inundaria a tela.
 */
async function registrarExcessoVelocidade(
  placa: string,
  speedKmh: number,
  limiteKmh: number,
  capturedAt: Date,
  latitude: number,
  longitude: number,
  localizacao: string | null,
): Promise<void> {
  const aberto = await prisma.speedAlert.findFirst({
    where: { placa, acknowledgedAt: null },
    orderBy: { createdAt: 'desc' },
  })
  if (aberto) {
    if (speedKmh > aberto.speedKmh) {
      await prisma.speedAlert.update({
        where: { id: aberto.id },
        data: { speedKmh, capturedAt, latitude, longitude, localizacao },
      })
    }
    return
  }
  await prisma.speedAlert.create({
    data: { placa, speedKmh, limiteKmh, capturedAt, latitude, longitude, localizacao },
  })
}

interface VisitaAberta {
  id: string
  locationId: string
}

/**
 * Motor de permanência por local (geofence) — pedido do usuário 2026-08-03:
 * "relatórios do tempo que ficou em cada local, hora de chegada e saída".
 * Estado (visita aberta por placa) fica em memória durante o sync inteiro —
 * as linhas são processadas em ordem cronológica por placa (ver chamada mais
 * abaixo), então dá pra decidir entra/sai sem reconsultar o banco a cada
 * posição.
 */
async function processarVisitaLocal(
  placa: string,
  capturedAt: Date,
  coords: { lat: number; lng: number },
  locations: (GeofenceLocation & { id: string })[],
  abertas: Map<string, VisitaAberta>,
): Promise<void> {
  const local = findContainingLocation(coords, locations)
  const aberta = abertas.get(placa)

  if (local) {
    if (aberta?.locationId === local.id) return // continua no mesmo local, nada a fazer
    if (aberta) {
      await prisma.locationVisit.update({ where: { id: aberta.id }, data: { saida: capturedAt } })
    }
    const nova = await prisma.locationVisit.create({
      data: { locationId: local.id, placa, chegada: capturedAt },
    })
    abertas.set(placa, { id: nova.id, locationId: local.id })
    return
  }

  if (aberta) {
    await prisma.locationVisit.update({ where: { id: aberta.id }, data: { saida: capturedAt } })
    abertas.delete(placa)
  }
}

/**
 * Depois de sincronizar `fase1_omnilink_posicoes`, converte cada linha bruta
 * (campos em texto formatado — ver comentário em
 * `src/lib/sync/connectors/omnilink.ts`) em `VehiclePosition`, usado pelo
 * mapa da frota (`/dashboard/fase1/mapa`). Upsert por (placa, capturedAt) —
 * migration `..._vehicle_position_unique` trocou o índice simples por
 * `@@unique`, permitindo sincronizações com janelas sobrepostas sem duplicar.
 */
export async function processOmnilinkPosicoes(rows: ExternalRow[]): Promise<void> {
  const limiteVelocidade = await getLimiteVelocidade()

  const locations = await prisma.location.findMany({
    where: { active: true },
    select: { id: true, latitude: true, longitude: true, raioMetros: true, polygon: true },
  })
  const locationsGeofence = locations.map((l) => ({
    ...l,
    polygon: (l.polygon as { lat: number; lng: number }[] | null) ?? null,
  }))
  const visitasAbertasIniciais = await prisma.locationVisit.findMany({
    where: { saida: null },
    orderBy: { chegada: 'desc' },
  })
  const abertas = new Map<string, VisitaAberta>()
  for (const v of visitasAbertasIniciais) {
    if (!abertas.has(v.placa)) abertas.set(v.placa, { id: v.id, locationId: v.locationId })
  }

  // Ordem cronológica por placa — o motor de visita depende de processar
  // entra/sai na sequência real; a API não garante essa ordem por página.
  const rowsOrdenadas = [...rows].sort((a, b) => {
    const placaCmp = String(a.placa ?? '').localeCompare(String(b.placa ?? ''))
    if (placaCmp !== 0) return placaCmp
    return String(a._capturedAtIso ?? '').localeCompare(String(b._capturedAtIso ?? ''))
  })

  for (const row of rowsOrdenadas) {
    const placa = String(row.placa ?? '').trim().toUpperCase()
    const capturedAtIso = row._capturedAtIso ? String(row._capturedAtIso) : null
    const coords = parseLatLog(String(row.lat_log ?? ''))
    if (!placa || !capturedAtIso || !coords) continue

    const capturedAt = new Date(capturedAtIso)
    const { speedKmh, heading } = parseVelocidadeSentido(String(row.velocidade_sentido ?? ''))
    const estado = String(row.estado ?? '').trim()
    const causa = String(row.causa ?? '').trim()
    const status = causa && causa !== estado ? [estado, causa].filter(Boolean).join(' — ') : estado || null
    const localizacaoRaw = String(row.localizacao ?? '').trim()
    const localizacao = localizacaoRaw && localizacaoRaw !== '-' ? localizacaoRaw : null

    await prisma.vehiclePosition.upsert({
      where: { placa_capturedAt: { placa, capturedAt } },
      update: { latitude: coords.lat, longitude: coords.lng, speedKmh, heading, status, localizacao },
      create: {
        placa,
        capturedAt,
        latitude: coords.lat,
        longitude: coords.lng,
        speedKmh,
        heading,
        status,
        localizacao,
        source: 'OMNILINK',
      },
    })

    if (speedKmh != null && speedKmh > limiteVelocidade) {
      await registrarExcessoVelocidade(placa, speedKmh, limiteVelocidade, capturedAt, coords.lat, coords.lng, localizacao)
    }

    await processarVisitaLocal(placa, capturedAt, coords, locationsGeofence, abertas)
  }
  await purgeOldVehiclePositions()
}

/**
 * Encerra automaticamente a manutenção em aberto de uma placa quando surge
 * uma viagem nova (nota fiscal com DATASAIDA) para ela — pedido do usuário
 * 2026-08-17: "o veículo sai de manutenção manualmente ai passa a contar
 * como tempo disponível ou quando emitir uma nota para viagem". Só reage às
 * linhas NOVAS/atualizadas desta sincronização (incremental), não ao
 * dataset inteiro. Uma viagem com DATASAIDA anterior ao início da
 * manutenção não conta (nota antiga sendo re-sincronizada, não indica que o
 * caminhão voltou a rodar).
 */
export async function processFase1VendasTransporte(rows: ExternalRow[]): Promise<void> {
  const primeiraDataNovaPorPlaca = new Map<string, string>()
  for (const row of rows) {
    const placa = String(row.PLACA ?? '').trim().toUpperCase()
    // DATASAIDA chega aqui como Date nativo do Oracle (linhas cruas, antes do
    // round-trip por JSON no dataset_rows) — String(date) usa
    // Date.toString() ("Wed Aug 19 2026...") e não o formato ISO, quebrando o
    // slice(0,10) que o resto do código assume. Achado real 2026-08-19: todo
    // sync deste dataset falhava no pós-processamento por causa disso.
    const raw = row.DATASAIDA
    const data = raw instanceof Date ? raw.toISOString().slice(0, 10) : String(raw ?? '').slice(0, 10)
    if (!placa || !data) continue
    const atual = primeiraDataNovaPorPlaca.get(placa)
    if (!atual || data < atual) primeiraDataNovaPorPlaca.set(placa, data)
  }
  if (primeiraDataNovaPorPlaca.size === 0) return

  const abertas = await prisma.vehicleMaintenance.findMany({
    where: { placa: { in: [...primeiraDataNovaPorPlaca.keys()] }, endDate: null },
  })
  for (const m of abertas) {
    const primeiraViagemNova = primeiraDataNovaPorPlaca.get(m.placa)
    if (!primeiraViagemNova) continue
    const startDateStr = m.startDate.toISOString().slice(0, 10)
    if (primeiraViagemNova < startDateStr) continue
    await prisma.vehicleMaintenance.update({
      where: { id: m.id },
      data: { endDate: new Date(`${primeiraViagemNova}T00:00:00`) },
    })
  }
}

/** Passos extras específicos por dataset, executados após o sync bater com sucesso. */
export const POST_SYNC_PROCESSORS: Record<string, (rows: ExternalRow[]) => Promise<void>> = {
  fase1_custos_transporte: processCustosTransporteRodoviario,
  fase1_omnilink_posicoes: processOmnilinkPosicoes,
  fase1_vendas_transporte: processFase1VendasTransporte,
}
