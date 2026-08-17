import { NextResponse } from 'next/server'
import { requireResourceViewer } from '@/lib/api-helpers'
import { getAllTripsBasic } from '@/lib/fase1/get-trips-simple'

// Viagens (notas fiscais agregadas) para a tela de conciliação de tickets —
// versão enxuta do payload de /api/fase1/data, só os campos usados na
// comparação por placa/peso (ver src/lib/fase1/get-trips-simple.ts).
export async function GET() {
  const auth = await requireResourceViewer('tickets_viagem')
  if ('error' in auth) return auth.error
  const trips = await getAllTripsBasic()
  const enxuto = trips.map((t) => ({
    VIAGEM_KEY: t.VIAGEM_KEY,
    PLACA: t.PLACA,
    DATASAIDA: t.DATASAIDA,
    PESOLIQUIDO: t.PESOLIQUIDO,
    NOMEFANTASIA: t.NOMEFANTASIA,
    MOTORISTA: t.MOTORISTA,
    NUMEROMOV: t.NUMEROMOV,
  }))
  return NextResponse.json(enxuto)
}
