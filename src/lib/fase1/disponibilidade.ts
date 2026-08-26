import { horasCalendarioUtil, horasCalendarioUtilNoIntervalo } from './calendario-util'
import { haversineKm } from '@/lib/geo'

/**
 * Disponibilidade Mecânica e Eficiência Operacional (pedido do usuário
 * 2026-08-17) — calculadas sobre o calendário útil (seg-sex 12h/dia,
 * fim de semana 4h/dia). O usuário pediu as 3 variantes de eficiência para
 * comparar e validar qual reflete melhor a operação real; nenhuma delas
 * substitui as outras até essa validação.
 *
 * Disponibilidade Mecânica = (horas do calendário - horas em manutenção) / horas do calendário.
 */

export interface ManutencaoPeriodo {
  startDate: string
  endDate: string | null
}

export interface PosicaoSimples {
  capturedAt: string
  speedKmh: number | null
  lat?: number | null
  lng?: number | null
}

export interface DisponibilidadePlaca {
  placa: string
  horasCalendario: number
  horasManutencao: number
  horasDisponiveis: number
  disponibilidadeMecanicaPct: number
  horasRodando: number | null
  eficienciaHorasRodandoPct: number | null
  kmReal: number
  kmEsperadoAjustado: number
  eficienciaKmRitmoPct: number | null
  viagensReais: number
  viagensEsperadas: number | null
  eficienciaViagensPct: number | null
}

const LIMIAR_VELOCIDADE_RODANDO_KMH = 5
// Intervalo entre duas posições maior que isso não conta como "rodando
// contínuo" — provável parada real ou gap de sincronização do rastreador,
// não deslocamento (mesmo raciocínio de SALTO_GPS_MAXIMO_KM em critica.ts).
const GAP_MAXIMO_MINUTOS = 30
// Mesmo salto máximo já usado em critica.ts (kmPercorridoGps) — descarta
// erro grosseiro de GPS antes de estimar velocidade por distância.
const SALTO_GPS_MAXIMO_KM = 5

/** Soma, em horas, os intervalos entre posições consecutivas em que a placa estava com velocidade acima do limiar (GPS real, não estimativa). */
export function horasRodandoGps(posicoesOrdenadas: PosicaoSimples[]): number {
  let minutos = 0
  for (let i = 1; i < posicoesOrdenadas.length; i++) {
    const anterior = posicoesOrdenadas[i - 1]
    const atual = posicoesOrdenadas[i]
    const deltaMin = (Date.parse(atual.capturedAt) - Date.parse(anterior.capturedAt)) / 60_000
    if (deltaMin <= 0 || deltaMin > GAP_MAXIMO_MINUTOS) continue
    let rodando =
      (anterior.speedKmh ?? 0) > LIMIAR_VELOCIDADE_RODANDO_KMH || (atual.speedKmh ?? 0) > LIMIAR_VELOCIDADE_RODANDO_KMH

    // Achado real 2026-08-26 (placa TAK5C12, madrugada 24→25/08): o
    // rastreador Omnilink às vezes manda velocidade "-" (sem leitura
    // instantânea) mesmo com a placa realmente em deslocamento — sem este
    // fallback, o trecho inteiro "some" de qualquer cálculo baseado em
    // velocidade, mesmo com posições reais mostrando o caminhão mudando de
    // lugar. Só entra quando NENHUMA das duas leituras tem velocidade (não
    // sobrescreve um "0 km/h" real, que continua contando como parado);
    // mesma técnica de distância haversine já usada em `critica.ts`
    // (`kmPercorridoGps`), descartando saltos de GPS implausíveis.
    if (
      !rodando &&
      anterior.speedKmh == null &&
      atual.speedKmh == null &&
      anterior.lat != null &&
      anterior.lng != null &&
      atual.lat != null &&
      atual.lng != null
    ) {
      const distKm = haversineKm({ lat: anterior.lat, lng: anterior.lng }, { lat: atual.lat, lng: atual.lng })
      if (distKm <= SALTO_GPS_MAXIMO_KM) {
        const velEstimadaKmh = distKm / (deltaMin / 60)
        rodando = velEstimadaKmh > LIMIAR_VELOCIDADE_RODANDO_KMH
      }
    }
    if (rodando) minutos += deltaMin
  }
  return minutos / 60
}

export function calcularDisponibilidadePlaca(params: {
  placa: string
  from: string
  to: string
  manutencoes: ManutencaoPeriodo[]
  /** Já agregado (via `horasRodandoGps`, tipicamente calculado no servidor a partir do GPS bruto) — null quando ainda não carregado/sem dado. */
  horasRodando: number | null
  kmReal: number
  viagensReais: number
  metaKmMensal: number
  duracaoMediaViagemHoras: number | null
}): DisponibilidadePlaca {
  const { placa, from, to, manutencoes, horasRodando, kmReal, viagensReais, metaKmMensal, duracaoMediaViagemHoras } = params

  const horasCalendario = horasCalendarioUtil(from, to)
  const hoje = new Date().toISOString().slice(0, 10)
  const horasManutencao = manutencoes.reduce(
    (s, m) => s + horasCalendarioUtilNoIntervalo(m.startDate, m.endDate ?? hoje, from, to),
    0,
  )
  const horasDisponiveis = Math.max(0, horasCalendario - horasManutencao)
  const disponibilidadeMecanicaPct = horasCalendario > 0 ? (horasDisponiveis / horasCalendario) * 100 : 0

  const eficienciaHorasRodandoPct =
    horasRodando !== null && horasDisponiveis > 0 ? (horasRodando / horasDisponiveis) * 100 : null

  // Variante 2 (km real x esperado no ritmo, descontando manutenção): o mês é
  // aproximado a 30 dias para permitir o cálculo em qualquer recorte de
  // datas (não só o mês corrente, que é onde a meta RITMO_KM normalmente é
  // aplicada) — aproximação assumida e documentada, não uma medida exata.
  const nDias = Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1
  const kmEsperadoPeriodoCheio = metaKmMensal * (nDias / 30)
  const kmEsperadoAjustado = horasCalendario > 0 ? kmEsperadoPeriodoCheio * (horasDisponiveis / horasCalendario) : 0
  const eficienciaKmRitmoPct = kmEsperadoAjustado > 0 ? (kmReal / kmEsperadoAjustado) * 100 : null

  // Variante 3 (viagens concluídas x esperadas): usa a duração média real das
  // viagens da própria placa no período (ou o fallback da frota, quando a
  // placa não teve viagem nenhuma) para estimar quantas viagens caberiam nas
  // horas disponíveis.
  const viagensEsperadas =
    duracaoMediaViagemHoras && duracaoMediaViagemHoras > 0 ? horasDisponiveis / duracaoMediaViagemHoras : null
  const eficienciaViagensPct =
    viagensEsperadas && viagensEsperadas > 0 ? (viagensReais / viagensEsperadas) * 100 : null

  return {
    placa,
    horasCalendario,
    horasManutencao,
    horasDisponiveis,
    disponibilidadeMecanicaPct,
    horasRodando,
    eficienciaHorasRodandoPct,
    kmReal,
    kmEsperadoAjustado,
    eficienciaKmRitmoPct,
    viagensReais,
    viagensEsperadas,
    eficienciaViagensPct,
  }
}
