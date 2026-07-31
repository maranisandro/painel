/**
 * Controle de consumo de combustível (Officium/MySQL) — pedido do usuário
 * 2026-07-29 (nota "Acompanhamento consumo de combustível" no Obsidian).
 * Meta da frota: 2 km/l.
 *
 * O km/l usa o hodômetro (`pedometer`) registrado em cada abastecimento, não
 * o KM estimado por rota do painel de vendas — é a fonte mais precisa
 * disponível (medição real do veículo, não uma expectativa por trecho).
 * Cálculo padrão de frota — "tanque cheio a tanque cheio" (correção do
 * usuário 2026-07-30, a fórmula anterior estava invertida): o tanque fica
 * cheio a cada abastecimento, então os litros que fecham o trecho (o
 * abastecimento ATUAL, não o anterior) são o que foi consumido rodando até
 * ele — km do trecho ÷ litros deste abastecimento.
 *
 * Dois cuidados adicionados (pedido do usuário 2026-07-29, a partir de um
 * caso real: 28,47 km/l — hoje corrigido de outra forma pela fórmula acima,
 * mas os dois cuidados abaixo continuam válidos):
 *  1. Abastecimentos fracionados (mesmo hodômetro, mesmo dia — um complemento
 *     logo após o primeiro) são somados num só ponto antes de calcular os
 *     intervalos. Sem isso, um complemento pequeno "herda" toda a distância
 *     do trecho seguinte e gera um km/l impossível (litros de um topo de
 *     tanque não abastecem o trecho inteiro até o próximo abastecimento).
 *  2. O abastecimento anterior ao início do período filtrado sempre entra no
 *     histórico usado para calcular o primeiro intervalo dentro do período —
 *     sem isso, o primeiro abastecimento do período ficaria sem referência
 *     (km desde o anterior = nulo) mesmo quando existe abastecimento
 *     anterior real (só fora do filtro de data).
 *
 * Terceiro cuidado (pedido do usuário 2026-07-30, ao ver o produto real do
 * abastecimento pela primeira vez): a Officium registra Arla32 (aditivo do
 * escapamento) e lubrificante na MESMA tabela de abastecimento que o diesel
 * — não são combustível, então não podem entrar no cálculo de km/l. O
 * intervalo de km/l é sempre ANCORADO no abastecimento de diesel mais
 * recente (`lastDieselIdx`): uma parada só de Arla/lubrificante não fecha
 * nem abre intervalo de km/l (fica sem cálculo, "—" no painel), e a distância
 * até ela é somada ao próximo abastecimento de diesel. Numa parada mista
 * (diesel + Arla na mesma parada, mesmo hodômetro), só os litros de diesel
 * entram no divisor — os litros de Arla/lubrificante continuam somados no
 * total exibido, só não distorcem o km/l.
 */

type Row = Record<string, unknown>

export interface AbastecimentoDetalhe {
  data: string
  litros: number
  hodometro: number
  /** produto do ABASTECIMENTO (Diesel S10, Gasolina, Arla32…), não o produto transportado na venda */
  produto: string
  /** km desde o abastecimento de DIESEL anterior (null quando esta parada não tem diesel, ou é a primeira do histórico) */
  kmDesdeAnterior: number | null
  /** km/l do intervalo (km desde o diesel anterior ÷ litros de diesel deste abastecimento — tanque cheio a tanque cheio; null se esta parada não teve diesel, ex.: só Arla/lubrificante) */
  kmPorLitroIntervalo: number | null
  /** true = dentro do período selecionado; false = só serve de referência para o primeiro intervalo */
  noPeriodo: boolean
  /** true = este ponto é a soma de 2+ abastecimentos fracionados no mesmo hodômetro */
  fracionado: boolean
  /** motivo do alerta (ícone ⚠ no painel), null = sem nada fora do comum */
  alerta: string | null
}

/** 'normal' = sem alerta; 'atencao' = alerta isolado; 'critico' = padrão recorrente (3+ ou metade+ dos intervalos), risco de sensor quebrado ou fraude — merece investigação */
export type NivelAnormalidade = 'normal' | 'atencao' | 'critico'

export interface ConsumoPlaca {
  placa: string
  /** litros de TODOS os produtos (diesel + Arla32 + lubrificante…), só para exibição do total abastecido */
  litrosTotal: number
  kmRodado: number
  /** litros de DIESEL considerados no cálculo de km/l (kmRodado ÷ litrosConsiderados = kmPorLitro) — exposto para permitir combinar vários placas (ex.: ranking por motorista) sem recalcular a média errado */
  litrosConsiderados: number
  kmPorLitro: number | null
  abastecimentos: number
  /** produtos distintos abastecidos no período (Diesel S10 / Arla32 / …) */
  produtos: string
  detalhe: AbastecimentoDetalhe[]
  temAlerta: boolean
  /** nº de intervalos de diesel com alerta no período (pedido do usuário 2026-07-30: pontuar anormalidade/fraude) */
  alertasCount: number
  /** nº de intervalos de diesel válidos no período (denominador do score) */
  totalIntervalos: number
  /** 0-100: % dos intervalos de diesel do período que vieram com alerta */
  scoreAnormalidade: number
  nivelAnormalidade: NivelAnormalidade
}

const KM_INTERVALO_MAX = 5000 // descarta saltos de hodômetro implausíveis (reset/troca de painel)
// Só entra no cálculo de km/l quem é diesel de verdade (cobre "OLEO DIESEL",
// "OLEO DIESEL S10", "SERVICO ABASTECIMENTO DIESEL" — tudo que a Officium usa
// hoje). Arla32/gasolina/etanol/lubrificante continuam aparecendo na coluna
// Produto, só não entram na conta (pedido do usuário 2026-07-30).
const DIESEL_MATCH = /DIESEL/i

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Filtra o abastecimento às placas conhecidas do painel (frota própria com
 * nota fiscal emitida), calcula km/l por placa a partir das diferenças de
 * hodômetro entre abastecimentos consecutivos (todo o histórico até o fim do
 * período, para nunca perder a referência do primeiro abastecimento do
 * período) e sinaliza abastecimentos fora do padrão.
 */
export function calcularConsumo(
  rows: Row[],
  placasConhecidas: Set<string>,
  from: string,
  to: string,
  metaKmPorLitro = 2,
): ConsumoPlaca[] {
  const porPlaca = new Map<string, { data: string; pedometer: number; litros: number; produto: string }[]>()
  for (const r of rows) {
    const placa = String(r.PLACA ?? '').trim().toUpperCase()
    if (!placa || !placasConhecidas.has(placa)) continue
    const data = String(r.date ?? '').slice(0, 10)
    // Mantém histórico ANTERIOR ao período (referência do 1º intervalo);
    // só descarta o que é posterior ao fim do período selecionado.
    if (!data || data > to) continue
    const pedometer = num(r.pedometer)
    if (pedometer <= 0) continue
    const list = porPlaca.get(placa) ?? []
    list.push({ data, pedometer, litros: num(r.amount), produto: String(r.produto ?? '').trim() })
    porPlaca.set(placa, list)
  }

  const out: ConsumoPlaca[] = []
  for (const [placa, list] of porPlaca.entries()) {
    const sorted = [...list].sort(
      (a, b) => a.pedometer - b.pedometer || a.data.localeCompare(b.data),
    )

    // Junta abastecimentos fracionados (mesmo hodômetro = mesma parada,
    // complemento logo após o primeiro) num só ponto, somando os litros
    // (total, para exibição) e separando os litros de DIESEL (para o
    // cálculo) — e juntando os produtos distintos (ex.: Diesel + Arla32 na
    // mesma parada).
    const merged: {
      data: string
      pedometer: number
      litros: number
      litrosDiesel: number
      produto: string
      fracionado: boolean
    }[] = []
    for (const r of sorted) {
      const litrosDiesel = DIESEL_MATCH.test(r.produto) ? r.litros : 0
      const last = merged[merged.length - 1]
      if (last && last.pedometer === r.pedometer) {
        last.litros += r.litros
        last.litrosDiesel += litrosDiesel
        last.fracionado = true
        if (r.data > last.data) last.data = r.data
        if (r.produto && !last.produto.split(' / ').includes(r.produto)) {
          last.produto = last.produto ? `${last.produto} / ${r.produto}` : r.produto
        }
      } else {
        merged.push({ ...r, litrosDiesel, fracionado: false })
      }
    }

    const detalhe: AbastecimentoDetalhe[] = []
    let kmRodado = 0
    let litrosConsiderados = 0
    // Índice da última parada com diesel — âncora do intervalo de km/l (uma
    // parada só de Arla/lubrificante não conta, a distância até ela é
    // somada ao próximo abastecimento de diesel).
    let lastDieselIdx = -1
    for (let i = 0; i < merged.length; i++) {
      const atual = merged[i]
      const noPeriodo = atual.data >= from && atual.data <= to
      let kmDesdeAnterior: number | null = null
      let kmPorLitroIntervalo: number | null = null
      if (atual.litrosDiesel > 0 && lastDieselIdx >= 0) {
        const anteriorDiesel = merged[lastDieselIdx]
        const delta = atual.pedometer - anteriorDiesel.pedometer
        const valido = delta > 0 && delta <= KM_INTERVALO_MAX
        if (valido) {
          kmDesdeAnterior = delta
          kmPorLitroIntervalo = delta / atual.litrosDiesel
          if (noPeriodo) {
            kmRodado += delta
            litrosConsiderados += atual.litrosDiesel
          }
        }
      }
      if (atual.litrosDiesel > 0) lastDieselIdx = i
      const alerta =
        kmPorLitroIntervalo !== null && kmPorLitroIntervalo > metaKmPorLitro * 3
          ? `consumo muito acima do normal (${fmtKmL(kmPorLitroIntervalo)} km/l) — provável abastecimento incompleto (tanque não encheu totalmente)`
          : kmPorLitroIntervalo !== null && kmPorLitroIntervalo < metaKmPorLitro * 0.15
            ? `consumo muito abaixo do normal (${fmtKmL(kmPorLitroIntervalo)} km/l) — conferir hodômetro ou abastecimento duplicado`
            : null
      detalhe.push({
        data: atual.data,
        litros: atual.litros,
        hodometro: atual.pedometer,
        produto: atual.produto,
        kmDesdeAnterior,
        kmPorLitroIntervalo,
        noPeriodo,
        fracionado: atual.fracionado,
        alerta,
      })
    }

    const noPeriodoRows = detalhe.filter((d) => d.noPeriodo)
    if (noPeriodoRows.length === 0) continue
    const produtos = [
      ...new Set(noPeriodoRows.flatMap((d) => d.produto.split(' / ')).map((p) => p.trim()).filter(Boolean)),
    ].sort()
    const totalIntervalos = noPeriodoRows.filter((d) => d.kmPorLitroIntervalo !== null).length
    const alertasCount = noPeriodoRows.filter((d) => d.alerta !== null).length
    const { score, nivel } = classificarAnormalidade(alertasCount, totalIntervalos)
    out.push({
      placa,
      litrosTotal: noPeriodoRows.reduce((s, d) => s + d.litros, 0),
      kmRodado,
      litrosConsiderados,
      kmPorLitro: litrosConsiderados > 0 ? kmRodado / litrosConsiderados : null,
      abastecimentos: noPeriodoRows.length,
      produtos: produtos.join(' / '),
      // Mostra o período + 1 registro anterior, só para dar contexto ao primeiro intervalo
      detalhe: detalhe.slice(Math.max(0, detalhe.findIndex((d) => d.noPeriodo) - 1)),
      temAlerta: alertasCount > 0,
      alertasCount,
      totalIntervalos,
      scoreAnormalidade: score,
      nivelAnormalidade: nivel,
    })
  }
  return out.sort((a, b) => b.scoreAnormalidade - a.scoreAnormalidade || (a.kmPorLitro ?? Infinity) - (b.kmPorLitro ?? Infinity))
}

/**
 * Pontua anormalidade/fraude (pedido do usuário 2026-07-30, a partir do caso
 * TBH2C10 — hodômetro travado por meses): score = % dos intervalos do
 * período que vieram com alerta (consumo muito acima/abaixo do normal).
 * Nível escala pela RECORRÊNCIA, não só a % isolada — um alerta isolado é só
 * "atenção" (pode ser erro de digitação pontual), mas 3+ alertas ou metade+
 * dos abastecimentos fora do padrão é "crítico": ou o hodômetro está com
 * problema, ou há indício de fraude (abastecimento não condizente com o uso
 * real do veículo) — merece investigação, não é mais “ruído”.
 */
function classificarAnormalidade(
  alertasCount: number,
  totalIntervalos: number,
): { score: number; nivel: NivelAnormalidade } {
  if (alertasCount === 0 || totalIntervalos === 0) return { score: 0, nivel: 'normal' }
  const pct = alertasCount / totalIntervalos
  const score = Math.round(pct * 100)
  const nivel: NivelAnormalidade = alertasCount >= 3 || pct >= 0.5 ? 'critico' : 'atencao'
  return { score, nivel }
}

function fmtKmL(n: number): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
}

export interface ConsumoMotorista {
  motorista: string
  kmRodado: number
  litrosConsiderados: number
  kmPorLitro: number | null
  abastecimentos: number
  temAlerta: boolean
  alertasCount: number
  totalIntervalos: number
  scoreAnormalidade: number
  nivelAnormalidade: NivelAnormalidade
}

/**
 * Atribui cada abastecimento ao motorista pela DATA, não pelas placas que o
 * motorista dirigiu em algum momento do período (pedido do usuário
 * 2026-07-30): a Officium não registra motorista, só a Oracle (nas notas
 * fiscais de venda) — então o motorista de um abastecimento é o da nota mais
 * recente da MESMA placa com DATASAIDA ≤ data do abastecimento ("emite uma
 * nota hoje, todo abastecimento até aparecer nota de outro motorista é
 * dele"). `timelinePorPlaca` já vem ordenado por data.
 */
export function agruparConsumoPorMotorista(
  consumoPlacas: ConsumoPlaca[],
  timelinePorPlaca: Map<string, { data: string; motorista: string }[]>,
): ConsumoMotorista[] {
  const acc = new Map<
    string,
    { kmRodado: number; litrosConsiderados: number; abastecimentos: number; alertasCount: number; totalIntervalos: number }
  >()
  for (const c of consumoPlacas) {
    const timeline = timelinePorPlaca.get(c.placa)
    if (!timeline || timeline.length === 0) continue
    for (const d of c.detalhe) {
      // só intervalos de diesel dentro do período contam (mesmo critério do
      // total por placa) — paradas só de Arla/lubrificante (kmPorLitroIntervalo
      // null) não têm o que atribuir.
      if (!d.noPeriodo || d.kmDesdeAnterior === null || d.kmPorLitroIntervalo === null) continue
      // último registro da timeline com data ≤ abastecimento
      let motorista: string | null = null
      for (const t of timeline) {
        if (t.data <= d.data) motorista = t.motorista
        else break
      }
      if (!motorista) continue // abastecimento é anterior à 1ª nota conhecida da placa
      const litrosDiesel = d.kmDesdeAnterior / d.kmPorLitroIntervalo
      const entry =
        acc.get(motorista) ?? { kmRodado: 0, litrosConsiderados: 0, abastecimentos: 0, alertasCount: 0, totalIntervalos: 0 }
      entry.kmRodado += d.kmDesdeAnterior
      entry.litrosConsiderados += litrosDiesel
      entry.abastecimentos += 1
      entry.totalIntervalos += 1
      if (d.alerta) entry.alertasCount += 1
      acc.set(motorista, entry)
    }
  }
  return [...acc.entries()]
    .map(([motorista, e]) => {
      const { score, nivel } = classificarAnormalidade(e.alertasCount, e.totalIntervalos)
      return {
        motorista,
        kmRodado: e.kmRodado,
        litrosConsiderados: e.litrosConsiderados,
        kmPorLitro: e.litrosConsiderados > 0 ? e.kmRodado / e.litrosConsiderados : null,
        abastecimentos: e.abastecimentos,
        temAlerta: e.alertasCount > 0,
        alertasCount: e.alertasCount,
        totalIntervalos: e.totalIntervalos,
        scoreAnormalidade: score,
        nivelAnormalidade: nivel,
      }
    })
    .sort((a, b) => b.scoreAnormalidade - a.scoreAnormalidade || (a.kmPorLitro ?? Infinity) - (b.kmPorLitro ?? Infinity))
}
