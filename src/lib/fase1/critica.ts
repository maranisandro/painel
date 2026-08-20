/**
 * Fase 1 — Crítica ao modelo (combustível e transporte). Pedido do usuário
 * 2026-08-05: "para este caso dos desvios de combustível e transporte em
 * geral vamos montar uma aba com crítica ao modelo, sendo que cada problema
 * deve ter o reconhecimento formal, ou até mesmo ajuste na origem" — a
 * partir de um caso real (placa TBH2C10, ver Achado hodômetro travado).
 *
 * Os achados são RECALCULADOS AO VIVO a cada carregamento (não gravados) —
 * só o STATUS de tratamento (reconhecido/encaminhado) é persistido, casado
 * pela `chave` estável (ver `CriticaModeloAchado` no schema).
 */
import { calcularConsumo } from './fuel'
import { haversineKm } from '@/lib/geo'
import { aggregateTrips } from './trips'

type Row = Record<string, unknown>

export interface AchadoDetectado {
  categoria: string
  chave: string
  titulo: string
  descricao: string
}

const DIESEL_MATCH = /DIESEL/i

/**
 * Corte de data para os achados baseados em varredura histórica ampla —
 * pedido do usuário 2026-08-14: "sobre as críticas do sistema ficou muito
 * bom, mas vamos limitar a partir de Agosto, assim conseguimos tratar com
 * maior efetividade". Aplicado só nos achados que resgatam janelas antigas
 * do histórico inteiro (hodômetro travado/regrediu, anormalidade crítica,
 * desvio de rota GPS) — os que são inerentemente sobre um problema AINDA
 * ABERTO hoje (sem abastecer há muito tempo, viagem sem abastecimento)
 * continuam usando o histórico completo pra achar a última data real, senão
 * um veículo que não abastece desde julho ficaria invisível.
 */
const LIMIAR_DATA_CRITICA = '2026-08-01'

/**
 * Placas com nível de anormalidade "crítico" (3+ alertas ou metade+ dos
 * abastecimentos fora do padrão) considerando TODO o histórico — não só o
 * período selecionado no painel, para não perder um padrão recorrente que
 * caiu fora do filtro de data atual.
 */
export function achadosAnormalidadeCritica(
  rows: Row[],
  placasConhecidas: Set<string>,
  metaKmPorLitro: number,
): AchadoDetectado[] {
  const hoje = new Date().toISOString().slice(0, 10)
  const consumo = calcularConsumo(rows, placasConhecidas, LIMIAR_DATA_CRITICA, hoje, metaKmPorLitro)
  return consumo
    .filter((c) => c.nivelAnormalidade === 'critico')
    .map((c) => ({
      categoria: 'anormalidade_critica',
      chave: c.placa,
      titulo: `Placa ${c.placa} — consumo com padrão crítico de anormalidade`,
      descricao: `${c.alertasCount} de ${c.totalIntervalos} intervalo(s) de diesel com alerta em todo o histórico (${c.scoreAnormalidade}%) — hodômetro pode estar com problema, ou há indício de abastecimento incompatível com o uso real do veículo.`,
    }))
}

/** nº mínimo de leituras consecutivas com o MESMO hodômetro para soar como sensor travado (uma leitura repetida isolada pode ser coincidência/arredondamento) */
const MIN_OCORRENCIAS_TRAVADO = 3

/**
 * Hodômetro sem nenhuma evolução por várias leituras de diesel seguidas —
 * achado real 2026-08-05 (placa TBH2C10: hodômetro travado em 79.337 km por
 * ~3 meses, enquanto outra série de leituras da MESMA placa subia
 * normalmente sob um rótulo de produto diferente — duas fontes conflitantes
 * de hodômetro na Officium para o mesmo veículo).
 */
export function achadosHodometroTravado(rows: Row[], placasConhecidas: Set<string>): AchadoDetectado[] {
  const porPlaca = new Map<string, { data: string; pedometer: number }[]>()
  for (const r of rows) {
    const placa = String((r as Row).PLACA ?? '').trim().toUpperCase()
    if (!placa || !placasConhecidas.has(placa)) continue
    const produto = String((r as Row).produto ?? '').trim()
    if (!DIESEL_MATCH.test(produto)) continue
    const pedometer = Number((r as Row).pedometer) || 0
    if (pedometer <= 0) continue
    const data = String((r as Row).date ?? '')
    if (!data || data < LIMIAR_DATA_CRITICA) continue
    const list = porPlaca.get(placa) ?? []
    list.push({ data, pedometer })
    porPlaca.set(placa, list)
  }

  const out: AchadoDetectado[] = []
  for (const [placa, list] of porPlaca.entries()) {
    const sorted = [...list].sort((a, b) => a.data.localeCompare(b.data))
    let inicioSerie = 0
    for (let i = 1; i <= sorted.length; i++) {
      if (i < sorted.length && sorted[i].pedometer === sorted[inicioSerie].pedometer) continue
      const ocorrencias = i - inicioSerie
      if (ocorrencias >= MIN_OCORRENCIAS_TRAVADO) {
        out.push({
          categoria: 'hodometro_travado',
          // Inclui a data de início da série na chave — o MESMO hodômetro
          // pode "travar" mais de uma vez ao longo do histórico da placa
          // (achado real: TBH2C10 trava em 79.337 km em 4 janelas
          // diferentes), e cada ocorrência precisa ser um achado distinto
          // e reconhecível separadamente.
          chave: `${placa}|${sorted[inicioSerie].pedometer}|${sorted[inicioSerie].data}`,
          titulo: `Placa ${placa} — hodômetro parado em ${sorted[inicioSerie].pedometer.toLocaleString('pt-BR')} km`,
          descricao: `${ocorrencias} abastecimentos de diesel seguidos com o MESMO hodômetro (${sorted[inicioSerie].pedometer.toLocaleString('pt-BR')} km), de ${sorted[inicioSerie].data.slice(0, 10)} a ${sorted[i - 1].data.slice(0, 10)} — sensor/telemetria provavelmente travado, ou há uma segunda fonte de hodômetro conflitante para a mesma placa na Officium.`,
        })
      }
      inicioSerie = i
    }
  }
  return out
}

/**
 * Hodômetro só pode crescer com o tempo (nunca reduzir) — pedido do usuário
 * 2026-08-05: "todo hodômetro só pode evoluir ou seja crescer assim como a
 * data, o hodômetro não pode reduzir com a passagem do tempo. a não ser que
 * haja uma troca de hodômetro que não está contemplada ainda". Diferente de
 * `achadosHodometroTravado` (mesmo valor repetido — sensor parado): aqui é
 * uma QUEDA real de valor entre duas leituras de diesel em sequência, o que
 * é fisicamente impossível sem uma troca de equipamento/hodômetro — e como
 * o cadastro de troca de hodômetro ainda não existe no sistema, toda queda
 * detectada hoje é, por definição, uma inconsistência a apurar. Por isso
 * este achado SEMPRE soa (não depende de atingir um score "crítico" como em
 * `achadosAnormalidadeCritica" — uma única queda já é, por regra, inválida).
 */
export function achadosHodometroRegrediu(rows: Row[], placasConhecidas: Set<string>): AchadoDetectado[] {
  const porPlaca = new Map<string, { data: string; pedometer: number }[]>()
  for (const r of rows) {
    const placa = String((r as Row).PLACA ?? '').trim().toUpperCase()
    if (!placa || !placasConhecidas.has(placa)) continue
    const produto = String((r as Row).produto ?? '').trim()
    if (!DIESEL_MATCH.test(produto)) continue
    const pedometer = Number((r as Row).pedometer) || 0
    if (pedometer <= 0) continue
    const data = String((r as Row).date ?? '')
    if (!data || data < LIMIAR_DATA_CRITICA) continue
    const list = porPlaca.get(placa) ?? []
    list.push({ data, pedometer })
    porPlaca.set(placa, list)
  }

  const out: AchadoDetectado[] = []
  for (const [placa, list] of porPlaca.entries()) {
    const sorted = [...list].sort((a, b) => a.data.localeCompare(b.data))
    for (let i = 1; i < sorted.length; i++) {
      const anterior = sorted[i - 1]
      const atual = sorted[i]
      if (atual.pedometer >= anterior.pedometer) continue // igual = travado (outro achado); crescente = normal
      out.push({
        categoria: 'hodometro_regrediu',
        chave: `${placa}|${anterior.data}|${anterior.pedometer}|${atual.data}|${atual.pedometer}`,
        titulo: `Placa ${placa} — hodômetro caiu de ${anterior.pedometer.toLocaleString('pt-BR')} para ${atual.pedometer.toLocaleString('pt-BR')} km`,
        descricao: `Em ${anterior.data.slice(0, 10)} o hodômetro registrado era ${anterior.pedometer.toLocaleString('pt-BR')} km; no abastecimento seguinte, em ${atual.data.slice(0, 10)}, caiu para ${atual.pedometer.toLocaleString('pt-BR')} km — hodômetro nunca pode reduzir com o tempo, a não ser que o equipamento tenha sido trocado (cadastro de troca de hodômetro ainda não existe no sistema). Confira se houve troca de equipamento, erro de digitação, ou mistura de duas placas com o mesmo cadastro.`,
      })
    }
  }
  return out
}

/**
 * Nº mínimo de dias sem nenhum abastecimento de diesel para soar como
 * anormal — pedido do usuário 2026-08-05: "seja muito tempo sem abastecer...
 * o que julgar que seja interessante". Calibrado com dados reais da frota
 * (2026-08-05): com 10 dias, 8 de 49 placas próprias soam (lista acionável,
 * sem virar ruído); com 20 dias só 1 soaria — baixo demais para o pedido
 * explícito de "sermos mais críticos".
 */
const LIMIAR_DIAS_SEM_ABASTECER = 10

/**
 * Placas sem NENHUM abastecimento de diesel registrado há muito tempo —
 * sinal operacional simples, independente de a placa ter viagem ou não no
 * período (ver `achadosViagemSemAbastecimento` para o cruzamento com
 * viagens). Cobre o caso "veículo pode estar parado, ou abastecendo fora do
 * sistema" mesmo quando não há evidência direta de uso.
 */
export function achadosSemAbastecimentoProlongado(rows: Row[], placasConhecidas: Set<string>): AchadoDetectado[] {
  const hoje = new Date().toISOString().slice(0, 10)
  const ultimoDieselPorPlaca = new Map<string, string>()
  for (const r of rows) {
    const placa = String((r as Row).PLACA ?? '').trim().toUpperCase()
    if (!placa || !placasConhecidas.has(placa)) continue
    const produto = String((r as Row).produto ?? '').trim()
    if (!DIESEL_MATCH.test(produto)) continue
    const data = String((r as Row).date ?? '')
    if (!data) continue
    const atual = ultimoDieselPorPlaca.get(placa)
    if (!atual || data > atual) ultimoDieselPorPlaca.set(placa, data)
  }

  const out: AchadoDetectado[] = []
  for (const [placa, ultima] of ultimoDieselPorPlaca.entries()) {
    const dias = Math.floor((Date.parse(hoje) - Date.parse(ultima)) / 86_400_000)
    if (dias >= LIMIAR_DIAS_SEM_ABASTECER) {
      out.push({
        categoria: 'sem_abastecimento_prolongado',
        chave: `${placa}|${ultima}`,
        titulo: `Placa ${placa} — ${dias} dias sem abastecer`,
        descricao: `Último abastecimento de diesel registrado em ${ultima.slice(0, 10)} — ${dias} dias atrás. Confira se o veículo está parado (manutenção/férias do motorista) ou se o abastecimento está sendo feito fora do sistema (posto não integrado à Officium).`,
      })
    }
  }
  return out
}

/**
 * Nº mínimo de dias DISTINTOS com viagem, depois do último abastecimento
 * conhecido, para soar como anormal — pedido do usuário 2026-08-05, exemplo
 * literal: "equipamento que teve viagem e não teve abastecimento dentro do
 * normal". Calibrado com dados reais: com 3 viagens, 4 placas soam (inclui o
 * caso real de uma placa com 7 viagens e ZERO abastecimento no histórico
 * inteiro); com 2, sobe para 18 — normal demais para um caminhão rodar 2
 * viagens com o tanque cheio, viraria ruído.
 */
const LIMIAR_VIAGENS_SEM_ABASTECER = 3

/**
 * Cruza viagens (Fase 1, frota própria) com abastecimento de diesel: placas
 * que rodaram (tiveram nota fiscal com saída) depois do último abastecimento
 * conhecido, num volume que foge do padrão — indício de abastecimento feito
 * fora do sistema (posto não integrado), sincronização de dados faltando, ou
 * uso real do veículo sem repor combustível de forma incompatível com o
 * tanque. Quando a placa nunca teve NENHUM abastecimento no histórico, TODAS
 * as viagens contam (achado real 2026-08-05: placa SE00B48, 7 viagens desde
 * fevereiro/2026, zero abastecimento de diesel sincronizado).
 */
export function achadosViagemSemAbastecimento(
  tripsRows: Row[],
  abastecimentoRows: Row[],
  placasConhecidas: Set<string>,
): AchadoDetectado[] {
  const ultimoDieselPorPlaca = new Map<string, string>()
  for (const r of abastecimentoRows) {
    const placa = String((r as Row).PLACA ?? '').trim().toUpperCase()
    if (!placa || !placasConhecidas.has(placa)) continue
    const produto = String((r as Row).produto ?? '').trim()
    if (!DIESEL_MATCH.test(produto)) continue
    const data = String((r as Row).date ?? '')
    if (!data) continue
    const atual = ultimoDieselPorPlaca.get(placa)
    if (!atual || data > atual) ultimoDieselPorPlaca.set(placa, data)
  }

  const diasViagemPorPlaca = new Map<string, Set<string>>()
  for (const t of tripsRows) {
    const placa = String((t as Row).PLACA ?? '').trim().toUpperCase()
    if (!placa || !placasConhecidas.has(placa)) continue
    const data = String((t as Row).DATASAIDA ?? '').slice(0, 10)
    // Só conta viagens de Agosto em diante (pedido do usuário 2026-08-14) —
    // a busca do ÚLTIMO abastecimento acima continua no histórico completo
    // (senão uma placa sem abastecer desde julho ficaria invisível aqui).
    if (!data || data < LIMIAR_DATA_CRITICA) continue
    const set = diasViagemPorPlaca.get(placa) ?? new Set<string>()
    set.add(data)
    diasViagemPorPlaca.set(placa, set)
  }

  const out: AchadoDetectado[] = []
  for (const [placa, dias] of diasViagemPorPlaca.entries()) {
    const ultimoAbastecimento = ultimoDieselPorPlaca.get(placa) ?? null
    const viagensDepois = [...dias].filter((d) => !ultimoAbastecimento || d > ultimoAbastecimento).sort()
    if (viagensDepois.length >= LIMIAR_VIAGENS_SEM_ABASTECER) {
      out.push({
        categoria: 'viagem_sem_abastecimento',
        chave: `${placa}|${ultimoAbastecimento ?? 'nunca'}`,
        titulo: `Placa ${placa} — ${viagensDepois.length} viagens sem abastecimento correspondente`,
        descricao: ultimoAbastecimento
          ? `${viagensDepois.length} dias com viagem (${viagensDepois[0]} a ${viagensDepois[viagensDepois.length - 1]}) desde o último abastecimento de diesel registrado (${ultimoAbastecimento.slice(0, 10)}) — confira se o veículo abasteceu fora do sistema, ou se falta sincronizar dados de combustível.`
          : `${viagensDepois.length} dias com viagem (${viagensDepois[0]} a ${viagensDepois[viagensDepois.length - 1]}), sem NENHUM abastecimento de diesel registrado no histórico desta placa — confira se o cadastro de combustível está correto ou se o veículo abastece fora do sistema.`,
      })
    }
  }
  return out
}

export interface PosicaoGps {
  placa: string
  capturedAt: string // ISO
  latitude: number
  longitude: number
}

/**
 * km mínimo real (GPS) para considerar que a placa "rodou de verdade" no
 * cruzamento com abastecimento — pedido do usuário 2026-08-05: "caminhão
 * está rodando (eventos omnilink) e não tem abastecimento". Abaixo disso
 * pode ser só manobra de pátio/pequeno deslocamento, não uma viagem real.
 */
const KM_MOVIMENTO_MINIMO = 20

/**
 * Dias mínimos de janela rastreada (primeira à última posição GPS da placa)
 * antes de considerar "muito tempo rodando sem abastecer" um sinal
 * confiável — achado real ao testar com dados de verdade (2026-08-05): com
 * só 3 dias de histórico de GPS (a integração Omnilink é recente), quase
 * toda placa ativa aparecia como "suspeita" simplesmente porque o ciclo
 * normal de abastecimento (5-10 dias, ver achadosSemAbastecimentoProlongado)
 * é maior que a própria janela de rastreamento disponível — 21 de 49 placas
 * soariam por um falso positivo estrutural, não por indício real. Exigir
 * uma janela mínima faz o achado ficar mudo até haver histórico suficiente
 * para a comparação fazer sentido, em vez de soar com ruído sistemático.
 */
const JANELA_MINIMA_DIAS_MOVIMENTO = 5

/**
 * Descarta saltos entre posições GPS consecutivas maiores que isso — não é
 * deslocamento real, é falha de sinal/gap de sincronização (o conector
 * Omnilink tem um problema conhecido de rate-limit que gera lacunas, ver
 * achado de crítica ao modelo sobre a sincronização em si) ou "teleporte" de
 * GPS. Sem esse filtro, um gap de horas com sinal fraco antes/depois inflaria
 * a distância somada com uma linha reta improvável.
 */
const SALTO_GPS_MAXIMO_KM = 5

/** Soma a distância (haversine) entre posições GPS consecutivas de UMA placa, descartando saltos implausíveis (ver `SALTO_GPS_MAXIMO_KM`). */
export function kmPercorridoGps(posicoes: PosicaoGps[], saltoMaximoKm = SALTO_GPS_MAXIMO_KM): number {
  const ordenadas = [...posicoes].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
  let km = 0
  for (let i = 1; i < ordenadas.length; i++) {
    const d = haversineKm(
      { lat: ordenadas[i - 1].latitude, lng: ordenadas[i - 1].longitude },
      { lat: ordenadas[i].latitude, lng: ordenadas[i].longitude },
    )
    if (d > 0 && d <= saltoMaximoKm) km += d
  }
  return km
}

/**
 * Cruza o rastreamento real (Omnilink/`VehiclePosition`) com o abastecimento
 * de diesel — pedido do usuário 2026-08-05, exemplo literal: "equipamento
 * que teve viagem e não teve abastecimento dentro do normal", agora usando
 * evidência de movimento GPS em vez de nota fiscal (sinal independente —
 * pega casos que a nota fiscal sozinha não pegaria, e vice-versa). Só
 * cobre o período em que há rastreamento de fato (a integração Omnilink é
 * recente, poucos dias de histórico no início) — cresce conforme mais dados
 * forem sincronizados.
 */
export function achadosMovimentoSemAbastecimento(
  posicoesGps: PosicaoGps[],
  abastecimentoRows: Row[],
  placasConhecidas: Set<string>,
): AchadoDetectado[] {
  const ultimoDieselPorPlaca = new Map<string, string>()
  for (const r of abastecimentoRows) {
    const placa = String((r as Row).PLACA ?? '').trim().toUpperCase()
    if (!placa || !placasConhecidas.has(placa)) continue
    const produto = String((r as Row).produto ?? '').trim()
    if (!DIESEL_MATCH.test(produto)) continue
    const data = String((r as Row).date ?? '')
    if (!data) continue
    const atual = ultimoDieselPorPlaca.get(placa)
    if (!atual || data > atual) ultimoDieselPorPlaca.set(placa, data)
  }

  const posicoesPorPlaca = new Map<string, PosicaoGps[]>()
  for (const p of posicoesGps) {
    if (!placasConhecidas.has(p.placa)) continue
    const list = posicoesPorPlaca.get(p.placa) ?? []
    list.push(p)
    posicoesPorPlaca.set(p.placa, list)
  }

  const out: AchadoDetectado[] = []
  for (const [placa, posicoes] of posicoesPorPlaca.entries()) {
    if (posicoes.length < 2) continue
    const ordenadas = [...posicoes].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
    const primeiraData = ordenadas[0].capturedAt.slice(0, 10)
    const ultimaData = ordenadas[ordenadas.length - 1].capturedAt.slice(0, 10)
    const diasJanela = Math.floor((Date.parse(ultimaData) - Date.parse(primeiraData)) / 86_400_000)
    if (diasJanela < JANELA_MINIMA_DIAS_MOVIMENTO) continue
    const ultimoAbastecimento = ultimoDieselPorPlaca.get(placa) ?? null
    // Se já abasteceu em ou depois do início da janela rastreada, o
    // movimento está coberto — não é o caso "rodou sem abastecer".
    if (ultimoAbastecimento && ultimoAbastecimento >= primeiraData) continue
    const kmRodado = kmPercorridoGps(ordenadas)
    if (kmRodado < KM_MOVIMENTO_MINIMO) continue
    out.push({
      categoria: 'movimento_sem_abastecimento',
      chave: `${placa}|${primeiraData}|${ultimaData}`,
      titulo: `Placa ${placa} — ${Math.round(kmRodado)} km rodados (GPS) sem abastecimento no período`,
      descricao: ultimoAbastecimento
        ? `Rastreamento (Omnilink) mostra ~${Math.round(kmRodado)} km percorridos entre ${primeiraData} e ${ultimaData}, mas o último abastecimento de diesel registrado é de ${ultimoAbastecimento.slice(0, 10)} (antes do início do período rastreado) — confira se abasteceu fora do sistema.`
        : `Rastreamento (Omnilink) mostra ~${Math.round(kmRodado)} km percorridos entre ${primeiraData} e ${ultimaData}, sem NENHUM abastecimento de diesel registrado no histórico desta placa — confira se abasteceu fora do sistema ou se falta sincronizar dados de combustível.`,
    })
  }
  return out
}

/** nº mínimo de posições GPS na janela da viagem para confiar na soma de distância — poucos pontos podem vir só do início/fim do trajeto rastreado, subestimando bastante. */
const MIN_POSICOES_DESVIO_ROTA = 5

/** % de diferença entre o km da rota cadastrada e o km real (GPS) para soar como desvio — abaixo disso é ruído normal de trajeto (desvio de trânsito, parada, etc.). */
const LIMIAR_PERCENTUAL_DESVIO_ROTA = 0.3

/**
 * Compara o KM esperado da rota cadastrada (ida+volta, `KM_RODADO` de
 * `getAllTripsEnriched`) contra o km REAL percorrido segundo o GPS
 * (Omnilink) na janela da viagem (`DATASAIDA` até `RETORNO_PREVISTO` ou até
 * `RETORNO_PREVISTO`, e SÓ para viagens já concluídas — ver nota abaixo)
 * — pedido do usuário 2026-08-05: "preciso saber se é possível validar a
 * distância rodada de acordo com a movimentação do omnilink para ver se
 * bate com o KM das rotas cadastradas". Só verifica viagens dentro da
 * janela em que há rastreamento de fato — a integração Omnilink é recente
 * (poucos dias de histórico no início), então a cobertura cresce aos
 * poucos.
 *
 * BUG REAL encontrado testando com dados de verdade (2026-08-05): a
 * primeira versão comparava o km rodado ATÉ AGORA (viagem ainda em
 * andamento) contra o km esperado da viagem INTEIRA (ida+volta) — como toda
 * viagem em andamento ainda não completou a volta, isso SEMPRE dava um
 * "déficit" enorme (31 achados, todos negativos, alguns de -90% a -100%),
 * mesmo sem nenhum problema real. Corrigido: só compara viagens cujo
 * `RETORNO_PREVISTO` já passou (viagem presumivelmente concluída) — uma
 * comparação completo-contra-completo, não parcial-contra-completo.
 */
export function achadosDesvioRotaGps(tripsEnriquecidas: Row[], posicoesGps: PosicaoGps[]): AchadoDetectado[] {
  const posicoesPorPlaca = new Map<string, PosicaoGps[]>()
  const primeiraPosicaoPorPlaca = new Map<string, string>()
  for (const p of posicoesGps) {
    const list = posicoesPorPlaca.get(p.placa) ?? []
    list.push(p)
    posicoesPorPlaca.set(p.placa, list)
    const atual = primeiraPosicaoPorPlaca.get(p.placa)
    if (!atual || p.capturedAt < atual) primeiraPosicaoPorPlaca.set(p.placa, p.capturedAt)
  }

  const agora = new Date().toISOString()
  const out: AchadoDetectado[] = []
  for (const t of tripsEnriquecidas) {
    const kmEsperado = Number(t.KM_RODADO ?? 0)
    if (kmEsperado <= 0) continue // sem rota cadastrada, nada para comparar
    const placa = String(t.PLACA ?? '').trim().toUpperCase()
    const saida = String(t.DATASAIDA ?? '').slice(0, 10)
    if (!placa || !saida) continue
    // Pedido do usuário 2026-08-14: limitar os achados de varredura histórica a partir de Agosto.
    if (saida < LIMIAR_DATA_CRITICA) continue
    const retornoPrevisto = t.RETORNO_PREVISTO ? String(t.RETORNO_PREVISTO) : null
    // Só viagens já concluídas — comparar km parcial (em andamento) contra
    // o total ida+volta sempre pareceria um desvio, mesmo sem problema real.
    if (!retornoPrevisto || retornoPrevisto >= agora) continue
    const inicioJanela = `${saida}T00:00:00.000Z`
    // BUG REAL #2 (mesma causa raiz do #1, forma diferente): mesmo só com
    // viagens concluídas, se a viagem começou ANTES do início do
    // rastreamento GPS da placa (a integração Omnilink é recente), a soma
    // de km só captura o TRECHO FINAL da viagem (o que sobrou depois que o
    // rastreamento começou) — nunca a viagem inteira. Isso também produzia
    // só déficits, do tamanho errado. Corrigido: exige que a janela INTEIRA
    // da viagem esteja dentro do período com rastreamento real da placa.
    const primeiraPosicaoConhecida = primeiraPosicaoPorPlaca.get(placa)
    if (!primeiraPosicaoConhecida || inicioJanela < primeiraPosicaoConhecida) continue
    const posicoesDaViagem = (posicoesPorPlaca.get(placa) ?? []).filter(
      (p) => p.capturedAt >= inicioJanela && p.capturedAt <= retornoPrevisto,
    )
    if (posicoesDaViagem.length < MIN_POSICOES_DESVIO_ROTA) continue // sem cobertura de rastreamento suficiente nessa janela

    const kmGps = kmPercorridoGps(posicoesDaViagem)
    const desvioPercentual = (kmGps - kmEsperado) / kmEsperado
    if (Math.abs(desvioPercentual) < LIMIAR_PERCENTUAL_DESVIO_ROTA) continue

    out.push({
      categoria: 'desvio_rota_gps',
      chave: `${placa}|${saida}`,
      titulo: `Placa ${placa} (${saida}) — rota cadastrada ${Math.round(kmEsperado)} km, GPS mostra ${Math.round(kmGps)} km`,
      descricao: `A rota cadastrada para esta viagem prevê ${Math.round(kmEsperado)} km (ida+volta), mas o rastreamento GPS (Omnilink) mostra ~${Math.round(kmGps)} km percorridos na janela da viagem (${desvioPercentual > 0 ? '+' : ''}${Math.round(desvioPercentual * 100)}%) — confira se houve desvio de rota, trecho não cadastrado corretamente, ou viagem não totalmente realizada.`,
    })
  }
  return out
}

/**
 * Placa marcada como em manutenção (aberta, sem endDate) mas o rastreamento
 * real (Omnilink) mostra deslocamento — pedido do usuário 2026-08-17: "um
 * veículo em manutenção que começar a deslocar para alguma unidade ou
 * cliente deve criar uma crítica para ação". Não usa `LIMIAR_DATA_CRITICA`
 * (mesmo motivo de `achadosSemAbastecimentoProlongado`): é inerentemente
 * sobre um problema ainda em aberto agora, não uma varredura histórica.
 * Reaproveita o mesmo limiar mínimo de km real de `achadosMovimentoSemAbastecimento`
 * (`KM_MOVIMENTO_MINIMO`) para não soar com manobra de pátio/oficina.
 */
export function achadosMovimentoDuranteManutencao(
  manutencoesAbertas: { placa: string; startDate: string }[],
  posicoesGps: PosicaoGps[],
): AchadoDetectado[] {
  const posicoesPorPlaca = new Map<string, PosicaoGps[]>()
  for (const p of posicoesGps) {
    const list = posicoesPorPlaca.get(p.placa) ?? []
    list.push(p)
    posicoesPorPlaca.set(p.placa, list)
  }

  const out: AchadoDetectado[] = []
  for (const m of manutencoesAbertas) {
    const inicioJanela = `${m.startDate}T00:00:00.000Z`
    const posicoesDuranteManutencao = (posicoesPorPlaca.get(m.placa) ?? []).filter(
      (p) => p.capturedAt >= inicioJanela,
    )
    if (posicoesDuranteManutencao.length < 2) continue
    const kmRodado = kmPercorridoGps(posicoesDuranteManutencao)
    if (kmRodado < KM_MOVIMENTO_MINIMO) continue
    const ordenadas = [...posicoesDuranteManutencao].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
    const ultimaData = ordenadas[ordenadas.length - 1].capturedAt.slice(0, 10)
    out.push({
      categoria: 'movimento_durante_manutencao',
      chave: `manutencao-movimento-${m.placa}|${m.startDate}`,
      titulo: `Placa ${m.placa} — em manutenção, mas rastreamento mostra ${Math.round(kmRodado)} km rodados`,
      descricao: `Placa está com manutenção em aberto desde ${m.startDate.split('-').reverse().join('/')}, mas o rastreamento (Omnilink) mostra ~${Math.round(kmRodado)} km percorridos entre o início da manutenção e ${ultimaData.split('-').reverse().join('/')} — confira se o veículo já voltou a rodar (encerrar a manutenção) ou se é um deslocamento até a oficina/local de manutenção (sem indicar uso real).`,
    })
  }
  return out
}

/**
 * Contagem de viagens de junho/2026 por placa, colada pelo usuário em
 * 2026-08-13 como referência externa para conferência cruzada (fonte não
 * identificada na conversa — provavelmente planilha/relatório usado à
 * parte). Fixa aqui (não é um dataset sincronizado) só para gerar o achado
 * de divergência; se o usuário trouxer uma referência de outro mês, isto
 * precisa ser generalizado (guardar mês+placa+valor em vez de só placa).
 */
const REFERENCIA_VIAGENS_JUNHO_2026: Record<string, number> = {
  RHX5D97: 6,
  RHX5D99: 8,
  RHX5E04: 7,
  RVG1I92: 5,
  SDU4H73: 9,
  SDU4H74: 7,
  SDU4H75: 8,
  SES5B24: 13,
  SES5B32: 7,
  SES5B33: 5,
  SES5B34: 4,
  SES9H22: 5,
  SES9H23: 4,
  TAK5C10: 6,
  TAK5C11: 6,
  TAK5C13: 6,
  TAM6F66: 17,
  TAN0J58: 6,
  TAN0J59: 5,
  TAO6C01: 7,
  TBA3J98: 6,
  TBH2B95: 9,
  TBH2B96: 7,
  TBH2B97: 4,
  TBH2B98: 7,
  TBH2B99: 4,
  TBH2C01: 8,
  TBH2C02: 9,
  TBH2C04: 8,
  TBH2C08: 6,
  TBH2C10: 10,
  TBH2C14: 7,
  TBH2C16: 6,
  TBH2C18: 5,
  TBH2C19: 7,
  TBH2C21: 7,
  TBH2C23: 9,
  TBH2C30: 9,
  TBH2C31: 6,
  TBH2C32: 5,
}

/**
 * Placas com viagem real registrada (Fase 1, frota própria) mas SEM NENHUM
 * registro de composição cadastrado — pedido do usuário 2026-08-14, caso real
 * PVF3A38/TYS2I28: eram cadastradas como "cavalinho" mas na prática são
 * carreta (reboque sem motor, não é uma composição válida sozinha), então
 * foram excluídas do cadastro de composição; mas ambas TÊM viagem real no
 * histórico (PVF3A38: 1 viagem de Carvão; TYS2I28: 1 viagem de Cavaco) — pedido
 * explícito: "para o que for carreta excluir e colocar na crítica se houve
 * viagem para eles em algum momento com opção de reconhecer". Varre o
 * histórico INTEIRO (não só a partir de Agosto, ver `LIMIAR_DATA_CRITICA`) —
 * "em algum momento" no pedido do usuário é literal, e cortar o histórico
 * esconderia justamente o caso real que motivou o pedido (viagens antigas).
 */
export function achadosPlacaSemComposicao(placasComViagem: Row[], placasComComposicao: Set<string>): AchadoDetectado[] {
  const infoPorPlaca = new Map<string, { n: number; primeira: string; ultima: string; produtos: Set<string> }>()
  for (const t of placasComViagem) {
    const placa = String(t.PLACA ?? '').trim().toUpperCase()
    if (!placa || placasComComposicao.has(placa)) continue
    const data = String(t.DATASAIDA ?? '').slice(0, 10)
    if (!data) continue
    const info = infoPorPlaca.get(placa) ?? { n: 0, primeira: data, ultima: data, produtos: new Set<string>() }
    info.n++
    if (data < info.primeira) info.primeira = data
    if (data > info.ultima) info.ultima = data
    const produto = String(t.TipoProduto ?? '').trim()
    if (produto) info.produtos.add(produto)
    infoPorPlaca.set(placa, info)
  }

  const out: AchadoDetectado[] = []
  for (const [placa, info] of infoPorPlaca.entries()) {
    out.push({
      categoria: 'placa_sem_composicao',
      chave: `composicao-ausente-${placa}`,
      titulo: `Placa ${placa} — sem composição cadastrada, mas com viagem registrada`,
      descricao: `${info.n} viagem(ns) registrada(s) de ${info.primeira} a ${info.ultima} (produto: ${[...info.produtos].join(', ') || 'não identificado'}), mas a placa não tem NENHUM registro de composição — pode ser uma carreta (reboque sem motor, não é uma composição válida sozinha) removida do cadastro, ou um cadastro faltando. Confira se a viagem foi feita por outro veículo (erro de digitação da placa na NF) ou se a placa precisa de um cadastro de composição.`,
    })
  }
  return out.sort((a, b) => a.chave.localeCompare(b.chave))
}

/**
 * Placa TEM cadastro de composição, mas nenhum registro cobre a data da
 * viagem (o mais antigo começa depois da viagem acontecer) — diferente de
 * `achadosPlacaSemComposicao` (placa sem NENHUM registro). Pedido do usuário
 * 2026-08-20: "placa com viagem sem cadastro ajustado" — o cadastro existe,
 * só não foi ajustado (effectiveFrom) pra cobrir esse período, geralmente
 * porque a composição mudou e ninguém lançou a data de vigência mais antiga
 * (ou lançou tarde demais). `resolveComposition` retorna null quando nenhum
 * registro (nem o de cadastro "desde sempre") se aplica à data.
 */
export function achadosCadastroNaoAjustado(
  placasComViagem: Row[],
  placasComComposicao: Set<string>,
  resolveComposition: (placa: unknown, dateYmd: string) => string | null,
): AchadoDetectado[] {
  const infoPorPlaca = new Map<string, { n: number; primeira: string; ultima: string; produtos: Set<string> }>()
  for (const t of placasComViagem) {
    const placa = String(t.PLACA ?? '').trim().toUpperCase()
    if (!placa || !placasComComposicao.has(placa)) continue
    const data = String(t.DATASAIDA ?? '').slice(0, 10)
    if (!data) continue
    if (resolveComposition(placa, data) !== null) continue
    const info = infoPorPlaca.get(placa) ?? { n: 0, primeira: data, ultima: data, produtos: new Set<string>() }
    info.n++
    if (data < info.primeira) info.primeira = data
    if (data > info.ultima) info.ultima = data
    const produto = String(t.TipoProduto ?? '').trim()
    if (produto) info.produtos.add(produto)
    infoPorPlaca.set(placa, info)
  }

  const out: AchadoDetectado[] = []
  for (const [placa, info] of infoPorPlaca.entries()) {
    out.push({
      categoria: 'cadastro_nao_ajustado',
      chave: `cadastro-nao-ajustado-${placa}`,
      titulo: `Placa ${placa} — viagem antes da vigência do cadastro de composição`,
      descricao: `${info.n} viagem(ns) registrada(s) de ${info.primeira} a ${info.ultima} (produto: ${[...info.produtos].join(', ') || 'não identificado'}) aconteceram numa data anterior ao primeiro registro de composição da placa — o cadastro existe, mas a data de vigência (desde quando) não foi ajustada pra cobrir esse período. Confira se falta um registro mais antigo em Cadastros → Composições, ou se a data do registro atual está certa.`,
    })
  }
  return out.sort((a, b) => a.chave.localeCompare(b.chave))
}

/**
 * Abastecimento via TICKET (posto externo) perto (D-1, D ou D+1) de uma
 * viagem da mesma placa — pedido do usuário 2026-08-20: "quero critica caso
 * tenha abastecimento na ticket no mesmo dia ou dia + 1 ou dia -1 de uma NF,
 * pois este poderia ter abastecido no CTA". O posto interno (CTA) é o
 * esperado pra frota própria; um ticket externo (`source = 'TK'`) tão perto
 * da viagem é indício de que o motorista poderia ter usado o CTA em vez de
 * abastecer fora (ou de um lançamento duplicado/indevido).
 */
export function achadosAbastecimentoTicketPertoDeNota(
  abastecimento: Row[],
  placasComViagem: Row[],
): AchadoDetectado[] {
  const ticketsPorPlaca = new Map<string, { date: string; amount: number }[]>()
  for (const a of abastecimento) {
    if (String(a.source ?? '').toUpperCase() !== 'TK') continue
    const placa = String(a.PLACA ?? '').trim().toUpperCase()
    if (!placa) continue
    const list = ticketsPorPlaca.get(placa) ?? []
    list.push({ date: String(a.date ?? '').slice(0, 10), amount: Number(a.amount) || 0 })
    ticketsPorPlaca.set(placa, list)
  }
  if (ticketsPorPlaca.size === 0) return []

  const out: AchadoDetectado[] = []
  const vistos = new Set<string>()
  for (const t of placasComViagem) {
    const placa = String(t.PLACA ?? '').trim().toUpperCase()
    const dataSaida = String(t.DATASAIDA ?? '').slice(0, 10)
    if (!placa || !dataSaida) continue
    const tickets = ticketsPorPlaca.get(placa)
    if (!tickets) continue
    const dNota = new Date(`${dataSaida}T00:00:00`).getTime()
    for (const ticket of tickets) {
      const dTicket = new Date(`${ticket.date}T00:00:00`).getTime()
      const diffDias = Math.round((dTicket - dNota) / 86_400_000)
      if (Math.abs(diffDias) > 1) continue
      const chave = `ticket-perto-nota-${placa}-${dataSaida}-${ticket.date}`
      if (vistos.has(chave)) continue
      vistos.add(chave)
      out.push({
        categoria: 'abastecimento_ticket_perto_nota',
        chave,
        titulo: `Placa ${placa} — abastecimento por ticket (externo) perto de uma viagem`,
        descricao: `Abastecimento via ticket (posto externo) em ${ticket.date} (R$ ${ticket.amount.toFixed(2)}), a ${Math.abs(diffDias)} dia(s) da viagem de ${dataSaida} — confira se o veículo poderia ter abastecido no CTA (posto interno) em vez de pagar fora.`,
      })
    }
  }
  return out.sort((a, b) => a.chave.localeCompare(b.chave))
}

/**
 * Nota fiscal de transporte rodoviário aparecendo para uma placa que, na
 * data da viagem, já estava com composição Tritrem Florestal (transporte de
 * madeira, fora do escopo do Fase1) — pedido do usuário 2026-08-19: "se
 * alguma nota aparecer para estas placas que estão com composição de
 * tritrem esta deve voltar para o painel como crítica". `tripsComComposicao`
 * já deve trazer `TipoComposição` resolvido por data (ver
 * `applyCompositionOverrides`/`buildCompositionResolver`) — qualquer viagem
 * resolvida como Tritrem Florestal é a própria evidência do problema (esse
 * implemento não deveria gerar nota de transporte rodoviário).
 */
export function achadosNotaAposTransferenciaTritrem(tripsComComposicao: Row[]): AchadoDetectado[] {
  const porPlaca = new Map<string, { n: number; primeira: string; ultima: string }>()
  for (const t of tripsComComposicao) {
    if (String(t['TipoComposição'] ?? '') !== 'Tritrem Florestal') continue
    const placa = String(t.PLACA ?? '').trim().toUpperCase()
    const data = String(t.DATASAIDA ?? '').slice(0, 10)
    if (!placa || !data) continue
    const info = porPlaca.get(placa) ?? { n: 0, primeira: data, ultima: data }
    info.n++
    if (data < info.primeira) info.primeira = data
    if (data > info.ultima) info.ultima = data
    porPlaca.set(placa, info)
  }

  const out: AchadoDetectado[] = []
  for (const [placa, info] of porPlaca.entries()) {
    out.push({
      categoria: 'nota_apos_tritrem',
      chave: `nota-apos-tritrem-${placa}`,
      titulo: `Placa ${placa} — nota de transporte rodoviário com a placa já em Tritrem Florestal`,
      descricao: `${info.n} viagem(ns) de ${info.primeira} a ${info.ultima} apareceram no Transporte Rodoviário com a placa já cadastrada como Tritrem Florestal (transporte de madeira) na data da viagem — confira se a placa realmente voltou a fazer transporte rodoviário, ou se é um erro de nota/cadastro.`,
    })
  }
  return out.sort((a, b) => a.chave.localeCompare(b.chave))
}

/**
 * Comparativo do nº de viagens de junho/2026 do painel (agregação por
 * DATASAIDA+PLACA+MOTORISTA+destino, ver `aggregateTrips`) contra a
 * referência externa colada pelo usuário — pedido 2026-08-13: "fazer um
 * comparativo com os dados do painel e criar uma crítica no painel de
 * transporte". Só entra na lista de achados quem tem placa NA referência
 * (uma placa do painel ausente da lista do usuário não é necessariamente
 * problema — pode ser um recorte parcial da fonte externa).
 */
export function achadosComparativoViagensReferencia(placasComViagem: Row[]): AchadoDetectado[] {
  const doMes = placasComViagem.filter((r) => String(r.DATASAIDA ?? '').slice(0, 7) === '2026-06')
  const viagens = aggregateTrips(doMes)
  const contagemCalculada = new Map<string, number>()
  for (const v of viagens) {
    const placa = String(v.PLACA ?? '').trim().toUpperCase()
    contagemCalculada.set(placa, (contagemCalculada.get(placa) ?? 0) + 1)
  }

  const out: AchadoDetectado[] = []
  for (const [placa, esperado] of Object.entries(REFERENCIA_VIAGENS_JUNHO_2026)) {
    const calculado = contagemCalculada.get(placa) ?? 0
    if (calculado === esperado) continue
    const diferenca = calculado - esperado
    out.push({
      categoria: 'comparativo_viagens_junho_2026',
      chave: `viagens-jun26-${placa}`,
      titulo: `Placa ${placa} — divergência nas viagens de junho/2026 (painel ${calculado} × referência ${esperado})`,
      descricao: `O painel calcula ${calculado} viagem(ns) em junho/2026 para esta placa (agrupando por data+motorista+destino); a referência externa informada pelo usuário aponta ${esperado} — diferença de ${diferenca > 0 ? '+' : ''}${diferenca}. Conferir se há NF fora do critério de agrupamento, viagem sem PLACA lançada, ou diferença de critério entre as duas fontes.`,
    })
  }
  return out.sort((a, b) => a.chave.localeCompare(b.chave))
}
