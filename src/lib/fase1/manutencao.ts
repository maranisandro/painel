import { prisma } from '@/lib/prisma'
import { getAllTripsBasic } from './get-trips-simple'

/**
 * Ao entrar em manutenção, encerra o ciclo da última viagem da placa
 * (pedido do usuário 2026-08-17: "assim enviar para atrasos justificados,
 * assim encerra o ciclo da última viagem e inicia o tempo em manutenção") —
 * sem isso, a última viagem continuaria acumulando atraso no painel mesmo
 * com o caminhão parado por um motivo já conhecido. Localiza a viagem mais
 * recente da placa (mesma chave de agrupamento de `aggregateTrips`,
 * `VIAGEM_KEY`) e cria/atualiza a `TripJustification` correspondente,
 * usando a previsão de conclusão da manutenção como nova previsão de
 * retorno (quando informada).
 */
export async function justificarViagemAoIniciarManutencao(
  placa: string,
  startDate: Date,
  previsaoConclusao: Date | null,
): Promise<void> {
  const trips = await getAllTripsBasic()
  let ultima: Record<string, unknown> | null = null
  for (const t of trips) {
    if (String(t.PLACA ?? '').trim().toUpperCase() !== placa) continue
    const data = String(t.DATASAIDA ?? '').slice(0, 10)
    if (!data) continue
    const dataUltima = ultima ? String(ultima.DATASAIDA ?? '').slice(0, 10) : ''
    if (!ultima || data > dataUltima) ultima = t
  }
  if (!ultima) return // placa sem nenhuma viagem no histórico — nada a justificar

  const tripKey = String(ultima.VIAGEM_KEY ?? '')
  if (!tripKey) return

  const motivo = `Veículo entrou em manutenção em ${startDate.toISOString().slice(0, 10).split('-').reverse().join('/')}.`
  await prisma.tripJustification.upsert({
    where: { tripKey },
    create: { tripKey, motivo, novaPrevisao: previsaoConclusao },
    update: { motivo, novaPrevisao: previsaoConclusao },
  })
}
