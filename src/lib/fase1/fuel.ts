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
  /** data/hora completa (ISO, direto da tabela) — pedido do usuário 2026-08-03: "sempre usar data hora conforme dados da tabela" */
  data: string
  litros: number
  hodometro: number
  /** produto do ABASTECIMENTO (Diesel S10, Gasolina, Arla32…), não o produto transportado na venda */
  produto: string
  /** km desde o abastecimento de DIESEL anterior (null quando esta parada não tem diesel, ou é a primeira do histórico) */
  kmDesdeAnterior: number | null
  /** km/l do intervalo (km desde o diesel anterior ÷ litros de diesel deste abastecimento — tanque cheio a tanque cheio; null se esta parada não teve diesel, ex.: só Arla/lubrificante) */
  kmPorLitroIntervalo: number | null
  /**
   * km desde o abastecimento de ARLA anterior (null quando esta parada não
   * tem Arla, ou é o primeiro Arla do histórico) — pedido do usuário
   * 2026-08-14: "porque no arla não vem as médias?" (a aba Arla só mostrava
   * o total do período, sem intervalo por linha, igual ao Diesel já tinha).
   * Mesmo raciocínio do Diesel, mas ancorado no Arla anterior — ATENÇÃO:
   * mais ruidoso que o do Diesel, porque o Arla não é completado a cada
   * parada (o intervalo entre 2 abastecimentos de Arla é bem mais
   * irregular que entre 2 de diesel).
   */
  kmDesdeArlaAnterior: number | null
  /** Arla (L/km) do intervalo — litros de Arla desta parada ÷ km desde o Arla anterior; null se esta parada não teve Arla, ou é a primeira do histórico */
  arlaPorKmIntervalo: number | null
  /** true = dentro do período selecionado; false = só serve de referência para o primeiro intervalo */
  noPeriodo: boolean
  /** true = este ponto é a soma de 2+ abastecimentos fracionados no mesmo hodômetro e mesmo dia */
  fracionado: boolean
  /** abastecimentos individuais que compõem este ponto quando fracionado=true (pedido do usuário 2026-08-03: "pode fundir [por] data mas abrir as opções") — cada um com sua data/hora real */
  itens?: { data: string; litros: number; produto: string }[]
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
  /**
   * true = `kmPorLitro` NÃO veio de um intervalo válido dentro do período
   * selecionado — é o último km/l válido encontrado em qualquer ponto do
   * histórico da placa, usado como estimativa. Pedido do usuário 2026-08-05
   * (caso real TBH2C10, sem abastecimento válido no mês nem no anterior):
   * "pegar a média quando não houver abastecimento no mês ou no anterior,
   * pegar o último que encontrar" — em vez de deixar em branco.
   */
  kmPorLitroEstimado: boolean
  /** data do abastecimento que originou o km/l estimado (null quando kmPorLitroEstimado=false ou quando não existe nenhum intervalo válido em todo o histórico) */
  kmPorLitroReferenciaEm: string | null
  /** litros de ARLA32 no período — pedido do usuário 2026-08-03: "média de arla por km" */
  litrosArla: number
  /** litrosArla ÷ kmRodado (L de Arla por km) — mantido como dado de referência, mas NÃO é mais o indicador principal (ver `arlaPctDiesel`). */
  arlaPorKm: number | null
  /**
   * true = `arlaPorKm` não veio do período selecionado (sem km rodado
   * calculável no período) — é a razão litros-Arla/km de todo o histórico da
   * placa até `to`, usada como estimativa. Pedido do usuário 2026-08-13: "as
   * médias e último abastecimento deve acontecer para arla e diesel [também]
   * — não podemos ter média zerada", mesmo tratamento que `kmPorLitroEstimado`
   * já tinha só para diesel.
   */
  arlaPorKmEstimado: boolean
  /** último dia com abastecimento (diesel ou Arla) que entrou na razão histórica usada em `arlaPorKm` quando `arlaPorKmEstimado`=true; null caso contrário */
  arlaPorKmReferenciaEm: string | null
  /**
   * Arla como % do Diesel consumido (litrosArla ÷ litrosConsiderados × 100)
   * — pedido do usuário 2026-08-14: "o consumo de Arla 32 não é medido nem
   * em km/l nem em l/km, mas sim como uma porcentagem em relação ao consumo
   * de diesel. O padrão de mercado é que o veículo consuma entre 3% e 5% de
   * Arla para cada litro de diesel queimado (~1L de Arla a cada 20L de
   * diesel)". Este é o indicador principal agora — `arlaPorKm` continua
   * disponível só como dado de referência.
   */
  arlaPctDiesel: number | null
  /** mesmo tratamento de fallback histórico que `arlaPorKmEstimado`, aplicado ao `arlaPctDiesel`. */
  arlaPctDieselEstimado: boolean
  /**
   * Alerta quando `arlaPctDiesel` foge muito da faixa normal de mercado
   * (3%-5%) — abaixo de `ARLA_PCT_MIN_ALERTA` é o caso mais grave: indício
   * de adulteração/remoção do sistema de redução de emissões ("Arla
   * delete"), prática ilegal que pode gerar multa ambiental e anula a
   * garantia do motor. Acima de `ARLA_PCT_MAX_ALERTA` sugere vazamento ou
   * erro de abastecimento/leitura. `null` = dentro do normal ou sem dado
   * suficiente para avaliar.
   */
  arlaAlerta: string | null
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
  /**
   * TODOS os intervalos de diesel válidos desta placa em todo o histórico até
   * `to` (não só o período, não só o recorte exibido em `detalhe`) — base do
   * fallback "último abastecimento conhecido" por MOTORISTA (pedido do
   * usuário 2026-08-21), mesma ideia de `ultimoValido` internamente, mas
   * exposta por completo porque o fallback por motorista precisa cruzar cada
   * ponto com a timeline de vigência da placa (`agruparConsumoPorMotorista`),
   * não só o último ponto desta placa especificamente — um motorista pode ter
   * dirigido outra placa mais recentemente.
   */
  intervalosValidosHistorico: { data: string; kmPorLitro: number }[]
}

const KM_INTERVALO_MAX = 5000 // descarta saltos de hodômetro implausíveis (reset/troca de painel)
// Só entra no cálculo de km/l quem é diesel de verdade (cobre "OLEO DIESEL",
// "OLEO DIESEL S10", "SERVICO ABASTECIMENTO DIESEL" — tudo que a Officium usa
// hoje). Arla32/gasolina/etanol/lubrificante continuam aparecendo na coluna
// Produto, só não entram na conta (pedido do usuário 2026-07-30).
const DIESEL_MATCH = /DIESEL/i
// Arla32 (aditivo do escapamento) — pedido do usuário 2026-08-03: "preciso
// ter a média de arla por km". Cobre "ARLA 32 (GRUPO 30)" e "SERVICO
// ABASTECIMENTO ARLA", os dois nomes que a Officium usa hoje.
const ARLA_MATCH = /ARLA/i
const GASOLINA_MATCH = /GASOLINA/i
const ETANOL_MATCH = /ETANOL/i
// Faixa normal de mercado (pedido do usuário 2026-08-14): 3%-5% de Arla por
// litro de diesel queimado. Alerta só fora de uma margem mais larga que a
// faixa normal, pra não sinalizar toda variação pequena — abaixo de 1,5% é
// o caso mais grave (indício de "Arla delete"/adulteração do sistema de
// redução de emissões); acima de 8% sugere vazamento ou erro de leitura.
const ARLA_PCT_MIN_ALERTA = 1.5
const ARLA_PCT_MAX_ALERTA = 8

/**
 * Categoria normalizada do produto — pedido do usuário 2026-08-05: "ainda
 * estou vendo mistura de abastecimento entre diesel e arla... SERVICO
 * ABASTECIMENTO ARLA = ARLA 32 (GRUPO 30) e SERVICO ABASTECIMENTO DIESEL =
 * OLEO DIESEL S10". A Officium grava o MESMO combustível com rótulos
 * diferentes (achado real ao investigar: 'OLEO DIESEL S10'/'OLEO
 * DIESEL'/'SERVICO ABASTECIMENTO DIESEL' são todos diesel; 'ARLA 32 (GRUPO
 * 30)'/'ARLA 30 (GRUPO 29)'/'SERVICO ABASTECIMENTO ARLA' são todos Arla32).
 * Usada para decidir se dois registros são "o mesmo tipo de combustível"
 * (fusão de fracionado, ver abaixo) — nunca para decidir SE algo é diesel
 * (isso continua sendo `DIESEL_MATCH` direto, já correto).
 */
function categoriaProduto(produto: string): string {
  if (DIESEL_MATCH.test(produto)) return 'DIESEL'
  if (ARLA_MATCH.test(produto)) return 'ARLA'
  if (GASOLINA_MATCH.test(produto)) return 'GASOLINA'
  if (ETANOL_MATCH.test(produto)) return 'ETANOL'
  return produto.toUpperCase().trim() // lubrificantes/óleos raros: cada rótulo distinto continua a própria categoria
}

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
  // `data` guarda a data/hora COMPLETA vinda da tabela (pedido do usuário
  // 2026-08-03: "sempre usar data hora conforme dados da tabela") — só o
  // `dia` (AAAA-MM-DD) é usado para comparações de período/fusão; a hora
  // real fica disponível para exibir e para desempatar a ordenação.
  const porPlaca = new Map<
    string,
    { data: string; dia: string; pedometer: number; litros: number; produto: string }[]
  >()
  for (const r of rows) {
    const placa = String(r.PLACA ?? '').trim().toUpperCase()
    if (!placa || !placasConhecidas.has(placa)) continue
    const data = String(r.date ?? '')
    const dia = data.slice(0, 10)
    // Mantém histórico ANTERIOR ao período (referência do 1º intervalo);
    // só descarta o que é posterior ao fim do período selecionado.
    if (!dia || dia > to) continue
    const pedometer = num(r.pedometer)
    if (pedometer <= 0) continue
    const list = porPlaca.get(placa) ?? []
    list.push({ data, dia, pedometer, litros: num(r.amount), produto: String(r.produto ?? '').trim() })
    porPlaca.set(placa, list)
  }

  const out: ConsumoPlaca[] = []
  for (const [placa, list] of porPlaca.entries()) {
    // Ordenar por DATA/HORA completa (não por hodômetro) é essencial:
    // hodômetro é o que pode vir corrompido (sensor com defeito, reset, etc.
    // — caso real 2026-08-03, placa TBH2B96, hodômetro travado/retrocedido de
    // 08/07 a 28/07). Ordenar por pedometer primeiro embaralhava a ordem
    // cronológica real nesse cenário.
    const sorted = [...list].sort(
      (a, b) => a.data.localeCompare(b.data) || a.pedometer - b.pedometer,
    )

    // Junta abastecimentos fracionados num só ponto — mas só quando é
    // GENUINAMENTE a mesma parada: mesmo hodômetro, mesmo dia E MESMA
    // CATEGORIA de produto (pedido do usuário 2026-08-03: "não poderia ter
    // arla e diesel no mesmo abastecimento, produto e bico são diferentes,
    // são abastecimentos distintos"). Compara por CATEGORIA (`categoriaProduto`),
    // não pela string bruta — achado real 2026-08-05: a Officium grava o
    // MESMO combustível com rótulos diferentes conforme o sistema/período
    // ("OLEO DIESEL S10" vs "SERVICO ABASTECIMENTO DIESEL"), e comparar a
    // string bruta deixava a MESMA parada real virar 2 pontos separados —
    // cada um dividindo o hodômetro entre si, gerando um alerta falso de
    // "hodômetro não avançou" (delta=0) sem nenhum problema real. Cobre o
    // caso de fusão válida: duas passadas na mesma bomba do MESMO
    // combustível (ex.: completar o tanque de diesel em duas transações,
    // ou o mesmo evento logado sob 2 rótulos). Guarda os itens originais em
    // `itens` — pedido do usuário: "pode fundir [por] data mas abrir as
    // opções", para o operador ver o abastecimento individual por trás da
    // soma (inclusive o rótulo original de cada um).
    const merged: {
      data: string
      dia: string
      pedometer: number
      litros: number
      litrosDiesel: number
      litrosArla: number
      produto: string
      fracionado: boolean
      itens: { data: string; litros: number; produto: string }[]
    }[] = []
    for (const r of sorted) {
      const litrosDiesel = DIESEL_MATCH.test(r.produto) ? r.litros : 0
      const litrosArla = ARLA_MATCH.test(r.produto) ? r.litros : 0
      const last = merged[merged.length - 1]
      if (
        last &&
        last.pedometer === r.pedometer &&
        last.dia === r.dia &&
        categoriaProduto(last.produto) === categoriaProduto(r.produto)
      ) {
        last.litros += r.litros
        last.litrosDiesel += litrosDiesel
        last.litrosArla += litrosArla
        last.fracionado = true
        last.itens.push({ data: r.data, litros: r.litros, produto: r.produto })
        if (r.data > last.data) last.data = r.data
      } else {
        merged.push({
          ...r,
          litrosDiesel,
          litrosArla,
          fracionado: false,
          itens: [{ data: r.data, litros: r.litros, produto: r.produto }],
        })
      }
    }

    const detalhe: AbastecimentoDetalhe[] = []
    let kmRodado = 0
    let litrosConsiderados = 0
    // Não anda junto com os intervalos de diesel (Arla não é abastecido a
    // cada parada, então não tem "intervalo" próprio) — soma tudo que caiu
    // dentro do período e divide pelo kmRodado do período no final.
    let litrosArlaPeriodo = 0
    // Acumuladores de TODO o histórico até `to` (não só o período) — base do
    // fallback "última razão Arla/km conhecida" quando o período não tem km
    // rodado calculável (mesma ideia de `ultimoValido` abaixo, para diesel).
    let kmRodadoHistorico = 0
    let litrosArlaHistorico = 0
    // Base do fallback histórico de `arlaPctDiesel` — mesmo raciocínio de
    // `kmRodadoHistorico`/`litrosArlaHistorico`, mas em litros de diesel.
    let litrosDieselHistorico = 0
    let ultimaDataComAbastecimento: string | null = null
    // Índice da última parada com diesel — âncora do intervalo de km/l (uma
    // parada só de Arla/lubrificante não conta, a distância até ela é
    // somada ao próximo abastecimento de diesel).
    let lastDieselIdx = -1
    // Mesma ideia de lastDieselIdx, ancorando o intervalo do Arla em vez do
    // diesel — pedido do usuário 2026-08-14 ("porque no arla não vem as
    // médias?"): a aba Arla só mostrava o total do período, sem intervalo
    // por linha.
    let lastArlaIdx = -1
    // Último intervalo VÁLIDO encontrado em todo o histórico até `to`,
    // independente do período selecionado — usado como estimativa quando o
    // período não tem nenhum intervalo válido próprio (pedido do usuário
    // 2026-08-05, ver `kmPorLitroEstimado` na interface).
    let ultimoValido: { data: string; kmPorLitro: number } | null = null
    const intervalosValidosHistorico: { data: string; kmPorLitro: number }[] = []
    for (let i = 0; i < merged.length; i++) {
      const atual = merged[i]
      const noPeriodo = atual.dia >= from && atual.dia <= to
      if (noPeriodo) litrosArlaPeriodo += atual.litrosArla
      // Histórico completo (não só o período) — mesmo escopo de `ultimoValido`
      // abaixo, base do fallback de Arla quando o período não tem km rodado.
      litrosArlaHistorico += atual.litrosArla
      litrosDieselHistorico += atual.litrosDiesel
      if (atual.litros > 0) ultimaDataComAbastecimento = atual.data
      let kmDesdeAnterior: number | null = null
      let kmPorLitroIntervalo: number | null = null
      // true = houve abastecimento de diesel anterior para comparar (intervalo
      // "tentado"), mesmo que o hodômetro tenha vindo inválido — usado abaixo
      // para não descartar silenciosamente hodômetro travado/retrocedido.
      let intervaloTentado = false
      let hodometroInvalido = false
      if (atual.litrosDiesel > 0 && lastDieselIdx >= 0) {
        intervaloTentado = true
        const anteriorDiesel = merged[lastDieselIdx]
        const delta = atual.pedometer - anteriorDiesel.pedometer
        const valido = delta > 0 && delta <= KM_INTERVALO_MAX
        if (valido) {
          kmDesdeAnterior = delta
          kmPorLitroIntervalo = delta / atual.litrosDiesel
          ultimoValido = { data: atual.data, kmPorLitro: kmPorLitroIntervalo }
          intervalosValidosHistorico.push(ultimoValido)
          kmRodadoHistorico += delta
          if (noPeriodo) {
            kmRodado += delta
            litrosConsiderados += atual.litrosDiesel
          }
        } else {
          hodometroInvalido = true
        }
      }
      if (atual.litrosDiesel > 0) lastDieselIdx = i

      // Intervalo do Arla (L/km), ancorado no Arla anterior — mesmo
      // raciocínio do diesel acima, só que sem alerta/anomalia própria (não
      // existe meta de Arla pra comparar) e sem travar o hodômetro inválido
      // do diesel (é um cálculo independente).
      let kmDesdeArlaAnterior: number | null = null
      let arlaPorKmIntervalo: number | null = null
      if (atual.litrosArla > 0 && lastArlaIdx >= 0) {
        const anteriorArla = merged[lastArlaIdx]
        const deltaArla = atual.pedometer - anteriorArla.pedometer
        if (deltaArla > 0 && deltaArla <= KM_INTERVALO_MAX) {
          kmDesdeArlaAnterior = deltaArla
          arlaPorKmIntervalo = atual.litrosArla / deltaArla
        }
      }
      if (atual.litrosArla > 0) lastArlaIdx = i
      // Hodômetro travado/retrocedido (delta <= 0) é o caso mais grave — indica
      // sensor com defeito ou fraude, e sem isso o abastecimento simplesmente
      // desaparecia do cálculo sem aviso nenhum (pedido do usuário 2026-08-03,
      // caso real: placa TBH2B96, hodômetro parado em 121181 desde 08/07).
      const alerta = hodometroInvalido
        ? 'hodômetro não avançou ou retrocedeu desde o abastecimento de diesel anterior — sensor/telemetria pode estar com problema'
        : kmPorLitroIntervalo !== null && kmPorLitroIntervalo > metaKmPorLitro * 3
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
        kmDesdeArlaAnterior,
        arlaPorKmIntervalo,
        noPeriodo,
        fracionado: atual.fracionado,
        itens: atual.fracionado ? atual.itens : undefined,
        alerta,
      })
    }

    const noPeriodoRows = detalhe.filter((d) => d.noPeriodo)
    if (noPeriodoRows.length === 0) continue
    const produtos = [
      ...new Set(noPeriodoRows.flatMap((d) => d.produto.split(' / ')).map((p) => p.trim()).filter(Boolean)),
    ].sort()
    // Conta tanto os intervalos com km/l calculado quanto os com hodômetro
    // inválido (alerta sem km/l) — senão o hodômetro travado/retrocedido some
    // do denominador e a % de anomalia fica artificialmente baixa.
    const totalIntervalos = noPeriodoRows.filter((d) => d.kmPorLitroIntervalo !== null || d.alerta !== null).length
    const alertasCount = noPeriodoRows.filter((d) => d.alerta !== null).length
    const { score, nivel } = classificarAnormalidade(alertasCount, totalIntervalos)
    // Sem intervalo válido dentro do período (ex.: sem abastecimento no mês
    // nem no anterior, ou o único abastecimento do período veio com hodômetro
    // inválido) — cai para o último km/l válido conhecido em todo o
    // histórico da placa, em vez de deixar em branco.
    const kmPorLitroPeriodo = litrosConsiderados > 0 ? kmRodado / litrosConsiderados : null
    const kmPorLitro = kmPorLitroPeriodo ?? ultimoValido?.kmPorLitro ?? null
    const kmPorLitroEstimado = kmPorLitroPeriodo === null && ultimoValido !== null
    // Mesma lógica do km/l: sem km rodado calculável no período (kmRodado=0),
    // cai pra razão litros-Arla/km de TODO o histórico da placa até `to`, em
    // vez de mostrar "—"/zerado.
    const arlaPorKmPeriodo = kmRodado > 0 ? litrosArlaPeriodo / kmRodado : null
    const arlaPorKmHistorico = kmRodadoHistorico > 0 ? litrosArlaHistorico / kmRodadoHistorico : null
    const arlaPorKm = arlaPorKmPeriodo ?? arlaPorKmHistorico
    const arlaPorKmEstimado = arlaPorKmPeriodo === null && arlaPorKmHistorico !== null
    // Indicador principal (pedido do usuário 2026-08-14): Arla como % do
    // diesel consumido, não L/km — mesmo fallback histórico do km/l/arlaPorKm
    // quando o período não tem diesel suficiente pra calcular.
    const arlaPctDieselPeriodo = litrosConsiderados > 0 ? (litrosArlaPeriodo / litrosConsiderados) * 100 : null
    const arlaPctDieselHistorico = litrosDieselHistorico > 0 ? (litrosArlaHistorico / litrosDieselHistorico) * 100 : null
    const arlaPctDiesel = arlaPctDieselPeriodo ?? arlaPctDieselHistorico
    const arlaPctDieselEstimado = arlaPctDieselPeriodo === null && arlaPctDieselHistorico !== null
    const arlaAlerta =
      arlaPctDiesel === null
        ? null
        : arlaPctDiesel < ARLA_PCT_MIN_ALERTA
          ? `consumo de Arla muito abaixo do normal (${fmtKmL(arlaPctDiesel)}% do diesel, padrão de mercado é 3%-5%) — possível adulteração/remoção do sistema de redução de emissões, risco de multa ambiental e perda de garantia do motor`
          : arlaPctDiesel > ARLA_PCT_MAX_ALERTA
            ? `consumo de Arla muito acima do normal (${fmtKmL(arlaPctDiesel)}% do diesel, padrão de mercado é 3%-5%) — conferir vazamento ou erro de abastecimento/leitura`
            : null

    // Início do recorte de `detalhe` exibido: normalmente "período + 1
    // registro anterior" já bastava de contexto — mas achado real 2026-08-14
    // (usuário perguntou "não existe outro abastecimento de diesel antes
    // deste?" ao ver um km/l calculado sem nenhum diesel anterior visível na
    // aba Diesel): quando há abastecimento(s) de Arla ENTRE o último diesel
    // e o início do período, "1 registro anterior" pega o Arla mais recente,
    // não o diesel que de fato ancorou o cálculo do primeiro intervalo — o
    // diesel usado no cálculo ficava fora do recorte exibido, embora o
    // número mostrado estivesse certo (calculado sobre o histórico completo,
    // nunca sobre este recorte). Corrigido: o recorte sempre inclui pelo
    // menos até o último abastecimento de DIESEL anterior ao período.
    // Mesmo raciocínio, espelhado pro Arla (aba Arla precisa do mesmo
    // contexto — pedido do usuário 2026-08-14 sobre as médias por linha).
    const primeiroDoPeriodo = detalhe.findIndex((d) => d.noPeriodo)
    const limiteAntesDoPeriodo = primeiroDoPeriodo === -1 ? detalhe.length : primeiroDoPeriodo
    let ultimoDieselAntes = -1
    let ultimoArlaAntes = -1
    for (let i = limiteAntesDoPeriodo - 1; i >= 0; i--) {
      if (ultimoDieselAntes === -1 && DIESEL_MATCH.test(detalhe[i].produto)) ultimoDieselAntes = i
      if (ultimoArlaAntes === -1 && ARLA_MATCH.test(detalhe[i].produto)) ultimoArlaAntes = i
      if (ultimoDieselAntes !== -1 && ultimoArlaAntes !== -1) break
    }
    const candidatos = [limiteAntesDoPeriodo - 1, ultimoDieselAntes, ultimoArlaAntes].filter((i) => i !== -1)
    const inicioDetalhe = Math.max(0, candidatos.length > 0 ? Math.min(...candidatos) : limiteAntesDoPeriodo - 1)

    out.push({
      placa,
      litrosTotal: noPeriodoRows.reduce((s, d) => s + d.litros, 0),
      kmRodado,
      litrosConsiderados,
      kmPorLitro,
      kmPorLitroEstimado,
      kmPorLitroReferenciaEm: kmPorLitroEstimado ? (ultimoValido?.data ?? null) : null,
      litrosArla: litrosArlaPeriodo,
      arlaPorKm,
      arlaPorKmEstimado,
      arlaPorKmReferenciaEm: arlaPorKmEstimado ? ultimaDataComAbastecimento : null,
      arlaPctDiesel,
      arlaPctDieselEstimado,
      arlaAlerta,
      abastecimentos: noPeriodoRows.length,
      produtos: produtos.join(' / '),
      // Mostra o período + contexto anterior (ver inicioDetalhe acima) —
      // sempre até o último diesel anterior, não só "1 registro anterior".
      detalhe: detalhe.slice(inicioDetalhe),
      temAlerta: alertasCount > 0,
      alertasCount,
      totalIntervalos,
      scoreAnormalidade: score,
      nivelAnormalidade: nivel,
      intervalosValidosHistorico,
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
  /**
   * true = `kmPorLitro` não veio de nenhum abastecimento atribuível a este
   * motorista DENTRO do período — é o último km/l válido encontrado no
   * histórico completo do motorista (em qualquer placa que ele tenha
   * dirigido), igual ao fallback que `ConsumoPlaca.kmPorLitroEstimado` já
   * fazia por placa. Pedido do usuário 2026-08-21: "fallback de último
   * abastecimento por motorista" — hoje, sem abastecimento atribuível no
   * período (motorista novo, troca de caminhão no meio do período), o km/l
   * simplesmente ficava em branco em vez de mostrar a última referência
   * conhecida do próprio motorista.
   */
  kmPorLitroEstimado: boolean
  /** data do abastecimento (em qualquer placa) que originou o km/l estimado — null quando kmPorLitroEstimado=false */
  kmPorLitroReferenciaEm: string | null
  /** placa em que ocorreu o abastecimento de referência do fallback — null quando kmPorLitroEstimado=false */
  kmPorLitroReferenciaPlaca: string | null
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
  // Último intervalo válido de TODO o histórico (qualquer placa que o
  // motorista tenha dirigido, não só a do período) — base do fallback
  // "último abastecimento conhecido" quando o motorista não tem nenhum
  // abastecimento atribuível no período (ver `kmPorLitroEstimado` na
  // interface). Mesma ideia do `ultimoValido` de `calcularConsumo`, só que
  // por motorista em vez de por placa.
  const ultimoValidoPorMotorista = new Map<string, { data: string; kmPorLitro: number; placa: string }>()

  function motoristaEm(timeline: { data: string; motorista: string }[], data: string): string | null {
    // último registro da timeline com data ≤ abastecimento
    let motorista: string | null = null
    for (const t of timeline) {
      if (t.data <= data) motorista = t.motorista
      else break
    }
    return motorista
  }

  for (const c of consumoPlacas) {
    const timeline = timelinePorPlaca.get(c.placa)
    if (!timeline || timeline.length === 0) continue

    // Base do fallback — percorre TODO o histórico de intervalos válidos
    // desta placa (não só o período), atribuindo cada um ao motorista que
    // estava de posse do caminhão naquela data, e guarda sempre o mais
    // recente por motorista.
    for (const v of c.intervalosValidosHistorico) {
      const motorista = motoristaEm(timeline, v.data)
      if (!motorista) continue
      const atual = ultimoValidoPorMotorista.get(motorista)
      if (!atual || v.data > atual.data) {
        ultimoValidoPorMotorista.set(motorista, { data: v.data, kmPorLitro: v.kmPorLitro, placa: c.placa })
      }
    }

    for (const d of c.detalhe) {
      if (!d.noPeriodo) continue
      // Paradas só de Arla/lubrificante (sem diesel, sem intervalo tentado)
      // não têm o que atribuir — mas hodômetro inválido (alerta setado, sem
      // km/l calculável) ainda soma no denominador de anomalia do motorista,
      // mesmo sem contribuir km/litros (não dá pra saber quanto ele rodou
      // com um hodômetro travado/retrocedido).
      const intervaloTentado = d.kmDesdeAnterior !== null || d.alerta !== null
      if (!intervaloTentado) continue
      const motorista = motoristaEm(timeline, d.data)
      if (!motorista) continue // abastecimento é anterior à 1ª nota conhecida da placa
      const entry =
        acc.get(motorista) ?? { kmRodado: 0, litrosConsiderados: 0, abastecimentos: 0, alertasCount: 0, totalIntervalos: 0 }
      if (d.kmDesdeAnterior !== null && d.kmPorLitroIntervalo !== null) {
        const litrosDiesel = d.kmDesdeAnterior / d.kmPorLitroIntervalo
        entry.kmRodado += d.kmDesdeAnterior
        entry.litrosConsiderados += litrosDiesel
        entry.abastecimentos += 1
      }
      entry.totalIntervalos += 1
      if (d.alerta) entry.alertasCount += 1
      acc.set(motorista, entry)
    }
  }

  // Um motorista pode ter fallback (ultimoValidoPorMotorista) sem ter
  // nenhuma entrada em `acc` — ex.: trocou de caminhão no meio do período e
  // não abasteceu nenhuma vez com o novo. Sem isso ele nem apareceria na
  // lista, em vez de aparecer com o km/l estimado do caminhão anterior.
  const motoristas = new Set([...acc.keys(), ...ultimoValidoPorMotorista.keys()])

  return [...motoristas]
    .map((motorista) => {
      const e = acc.get(motorista) ?? { kmRodado: 0, litrosConsiderados: 0, abastecimentos: 0, alertasCount: 0, totalIntervalos: 0 }
      const { score, nivel } = classificarAnormalidade(e.alertasCount, e.totalIntervalos)
      const kmPorLitroPeriodo = e.litrosConsiderados > 0 ? e.kmRodado / e.litrosConsiderados : null
      const fallback = ultimoValidoPorMotorista.get(motorista) ?? null
      const kmPorLitro = kmPorLitroPeriodo ?? fallback?.kmPorLitro ?? null
      const kmPorLitroEstimado = kmPorLitroPeriodo === null && fallback !== null
      return {
        motorista,
        kmRodado: e.kmRodado,
        litrosConsiderados: e.litrosConsiderados,
        kmPorLitro,
        abastecimentos: e.abastecimentos,
        temAlerta: e.alertasCount > 0,
        alertasCount: e.alertasCount,
        totalIntervalos: e.totalIntervalos,
        scoreAnormalidade: score,
        nivelAnormalidade: nivel,
        kmPorLitroEstimado,
        kmPorLitroReferenciaEm: kmPorLitroEstimado ? fallback?.data ?? null : null,
        kmPorLitroReferenciaPlaca: kmPorLitroEstimado ? fallback?.placa ?? null : null,
      }
    })
    .sort((a, b) => b.scoreAnormalidade - a.scoreAnormalidade || (a.kmPorLitro ?? Infinity) - (b.kmPorLitro ?? Infinity))
}
