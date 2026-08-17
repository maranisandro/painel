import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireResourceEditor } from '@/lib/api-helpers'
import { findContainingLocation, agruparPorProximidade } from '@/lib/geo'

/**
 * Sugestão de Local tipo OFICINA (pedido do usuário 2026-08-17: "nos locais
 * que os veículos ficarem por mais tempo em manutenção criar um novo local
 * como oficina e pedir a confirmação do nome do local"). Diferente da
 * pendência de UNIDADE (que casa por coligada/filial), aqui não há
 * identificador de negócio — só coordenadas — então o candidato é um
 * CLUSTER de posições GPS (Omnilink) das placas com manutenção em aberto,
 * fora de qualquer Local já cadastrado, com permanência longa o bastante
 * para não ser ruído de trânsito.
 */

const RAIO_CLUSTER_METROS = 300 // mesma ordem de grandeza do raio padrão de um Local (500m)
const HORAS_MINIMAS_OFICINA = 6 // permanência mínima agregada para soar como "oficina", não uma parada rápida
const POSICOES_MINIMAS = 3 // evita 1-2 leituras isoladas (GPS ruidoso) virarem sugestão

interface PosicaoForaDeLocal {
  placa: string
  lat: number
  lng: number
  capturedAt: string
}


export async function GET() {
  const auth = await requireResourceEditor('locais')
  if ('error' in auth) return auth.error

  const manutencoesAbertas = await prisma.vehicleMaintenance.findMany({
    where: { endDate: null },
    select: { placa: true, startDate: true },
  })
  if (manutencoesAbertas.length === 0) return NextResponse.json([])

  const locations = await prisma.location.findMany({
    where: { active: true },
    select: { id: true, latitude: true, longitude: true, raioMetros: true, polygon: true },
  })
  const locationsGeofence = locations.map((l) => ({
    ...l,
    polygon: (l.polygon as { lat: number; lng: number }[] | null) ?? null,
  }))

  const posicoesForaDeLocal: PosicaoForaDeLocal[] = []
  for (const m of manutencoesAbertas) {
    const posicoes = await prisma.vehiclePosition.findMany({
      where: { placa: m.placa, capturedAt: { gte: m.startDate } },
      select: { placa: true, latitude: true, longitude: true, capturedAt: true },
    })
    for (const p of posicoes) {
      const dentro = findContainingLocation({ lat: p.latitude, lng: p.longitude }, locationsGeofence)
      if (dentro) continue
      posicoesForaDeLocal.push({
        placa: p.placa,
        lat: p.latitude,
        lng: p.longitude,
        capturedAt: p.capturedAt.toISOString(),
      })
    }
  }

  const candidatos = agruparPorProximidade(posicoesForaDeLocal, RAIO_CLUSTER_METROS)
    .map((itens) => {
      const latitude = itens.reduce((s, p) => s + p.lat, 0) / itens.length
      const longitude = itens.reduce((s, p) => s + p.lng, 0) / itens.length
      const datas = itens.map((p) => p.capturedAt).sort()
      return {
        latitude,
        longitude,
        nPosicoes: itens.length,
        placas: [...new Set(itens.map((p) => p.placa))].sort(),
        primeiraData: datas[0],
        ultimaData: datas[datas.length - 1],
        horasEstimadas: Math.round(((Date.parse(datas[datas.length - 1]) - Date.parse(datas[0])) / 3_600_000) * 10) / 10,
      }
    })
    .filter((c) => c.nPosicoes >= POSICOES_MINIMAS && c.horasEstimadas >= HORAS_MINIMAS_OFICINA)
    .sort((a, b) => b.horasEstimadas - a.horasEstimadas)

  return NextResponse.json(candidatos)
}
