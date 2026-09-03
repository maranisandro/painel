/**
 * Fase 3 — Produção e Venda de Madeira Tratada: análise de perda de preço.
 * Migrado do Power BI "Planep_Faturamento_New" (nota Obsidian "Fase 3 -
 * Produção e Venda de Madeira Tratada", pedido do usuário 2026-08-03).
 *
 * Ideia central (medidas `.ValorminM3`/`.Valor M3 Vendido`/`.IndicadorPrecoMedio`
 * do relatório original): cada venda tem um PREÇO MÍNIMO esperado (m3_minimo,
 * calculado no ComputedColumn do dataset a partir do ICMS do estado do
 * cliente × tipo de produto). Comparando o valor/m³ realmente vendido contra
 * a média ponderada desse mínimo no mix efetivamente vendido, dá pra apontar
 * exatamente onde (qual distribuidor/produto/tabela de preço) o preço
 * praticado ficou abaixo do esperado — a "perda de valor" que o usuário
 * pediu para entender.
 *
 * `m3_minimo` e `preco_ponderado` (linha × M3_TOTAL) já vêm calculados neste
 * módulo em vez de ComputedColumn porque envolvem multiplicação entre
 * colunas — o ComputedColumn (CONDITIONAL/LOOKUP) só devolve valores
 * categóricos fixos, não expressões aritméticas entre campos.
 */

type Row = Record<string, unknown>

// TipoProduto excluído do "m³ vendido" — conferido na medida DAX real
// `.Total m3 vendido` (FaturamentoNovo.tmdl): exclui SubTipoProduto Lenha e
// Lenha UTM; a exclusão de Serragem/Maravalha está COMENTADA no modelo ao
// vivo (`/*...SubTipoProduto<>"Serragem",...<>"Maravalha"*/`), ou seja, hoje
// essas duas ENTRAM no m³ vendido — corrigido em 2026-08-04 (antes excluía
// Serragem também, por engano). Sem impacto prático até agora porque
// Serragem tem M3_TOTAL=0 nos dados reais (TPRDCOMPL.M3 sem fator de
// conversão cadastrado), mas o critério certo é este.
//
// Valor padrão — pedido do usuário 2026-08-21 ("motor de fórmulas
// editável"): este e os 3 conjuntos de CODTMV abaixo passaram a ser
// configuráveis via Cadastros → Parâmetros (campo "Valor texto", lista
// separada por vírgula — códigos CODTMV_PRODUTOS_FORA_DO_M3/CODTMV_VENDA/
// CODTMV_BONIFICACAO/CODTMV_DEVOLUCAO). O valor abaixo é só o FALLBACK
// usado quando o parâmetro ainda não foi cadastrado — quem chama
// `prepararVendas` (rota /api/fase3/data) resolve o Parameter e passa o
// conjunto real via `config`. Não expostos como fórmula aritmética (o
// motor de parâmetros existente só faz +-*/ entre números) porque isto é
// filtro de conjunto/string, não conta — daí o campo `valueText` em vez de
// `formula`.
const PRODUTOS_FORA_DO_M3_PADRAO = new Set(['Lenha', 'Lenha UTM'])

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export type TipoMovimento = 'Vendas' | 'Devolucoes' | 'Bonificacoes'

/**
 * Buckets possíveis de ABREV_DISTRIBUIDOR (ComputedColumn, `prisma/seed.ts`)
 * — usado para apontar quais distribuidores não tiveram nenhum cliente/venda
 * no período (pedido do usuário 2026-08-04: "abrir clientes por
 * distribuidor... saber quais os distribuidores estão sem cliente"), já que
 * um distribuidor sem nenhuma linha simplesmente não aparece nas agregações.
 */
export const DISTRIBUIDORES_CONHECIDOS = ['PLANEP', 'TOP TOP', 'EXTRA', 'GREANY´S', 'RURAL MADEIRAS', 'SEM DISTRIBUIDOR']

export interface VendaLinha {
  data: string
  /** YYYY-MM — usado para agrupar desempenho por produto ao longo do tempo */
  mes: string
  distribuidor: string
  /** FCFOCOMPL.DISTRIBUIDOR bruto (ex. "C00003154") — usado para casar com DistributorQuota.codDistribuidor; distinto de `distribuidor` (bucket ABREV_DISTRIBUIDOR usado para exibição/agrupamento) */
  codDistribuidor: string
  cliente: string
  produto: string
  /** TPRD.CODIGOPRD (ex. "95.02.070006") — usado para casar com ProductQuota.codigoPrd; distinto de `produto` (nome de exibição) */
  codigoPrd: string
  tipoProduto: string
  /** Mourão/Peças dentro de Agronegócio (ou o próprio tipoProduto fora dele) — implementado 2026-08-04 a partir da nota original, nunca tinha sido feito antes */
  subTipoProduto: string
  tabelaPreco: string
  tipoMovimento: TipoMovimento
  quantidade: number
  /** QUANTIDADE × PRECO_VENDIDO, sem desconto — positivo mesmo em devolução (o sinal é aplicado ao agregar) */
  valorBruto: number
  desconto: number
  /**
   * QUANTIDADE × PRECO_VENDIDO — valor nominal da bonificação, mesma lógica
   * do painel Power BI antigo. O usuário pediu em 2026-08-04 para calcular
   * como (PRECO_MEDIO_TABELA4 − PRECO_VENDIDO) × QUANTIDADE, mas reverteu
   * no mesmo dia ("pode seguir a lógica do painel antigo até ajustarmos") —
   * `PRECO_MEDIO_TABELA4` continua disponível na query para quando essa
   * conta for retomada.
   */
  valorBonificacao: number
  /** preço de tabela do distribuidor (ou PRECO_VENDIDO quando não há tabela) — guardado para quando a conta de bonificação for retomada */
  precoMedioTabela4: number
  /**
   * true = CODTMV era 2.2.48 na origem (Oracle), independente de como a
   * linha acabou classificada em `tipoMovimento` (a Planep é reclassificada
   * para 'Vendas', mas continua com bonificacaoOriginal=true) — pedido do
   * usuário 2026-08-04: "marque estas vendas bonificadas e para quais
   * clientes estão indo estas bonificações".
   */
  bonificacaoOriginal: boolean
  /**
   * true = TMOVCOMPL.BONIFICACAO='SIM' na origem — flag bruto e INDEPENDENTE
   * de `bonificacaoOriginal`/CODTMV. Achado 2026-08-04 comparando um export
   * real do Power BI: 247 linhas de julho/Agronegócio tinham esse flag='SIM'
   * mas CODTMV de venda normal (não 2.2.48) — um desconto embutido numa
   * venda regular, sem passar pelo movimento formal de bonificação. É esse
   * flag (não o CODTMV) que a fórmula original de PRECO_BASE usa.
   */
  flagBonificacao: boolean
  /**
   * "preco_base" da nota original — ajustado pelo usuário 2026-08-24 (medida
   * DAX): PRECO_VENDIDO quando abaixo do PRECO_MEDIO_TABELA4 (nunca puxa pra
   * cima um preço já menor que a tabela) ou quando `flagBonificacao` é falso
   * (venda normal, sem o flag bruto — não `bonificacaoOriginal`/CODTMV);
   * PRECO_MEDIO_TABELA4 só quando `flagBonificacao` é verdadeiro E o preço
   * vendido não é menor que ele. Ver `precoBase` em `prepararVendas` para os
   * 4 ramos exatos. Usado em `agregarVendas`/`agruparCargas` para o
   * faturamento bruto (equivalente a ".Fat. Bruto Venda" do Power BI);
   * `valorBruto` continua com o preço REALMENTE cobrado, usado onde a
   * pergunta é "quanto o cliente pagou de fato" (abaixo da tabela4,
   * dispersão de preço, histórico de cliente).
   */
  precoBase: number
  /** QUANTIDADE × precoBase */
  valorBase: number
  /** placa do veículo (TMOVCOMPL.PLACA) — usado para juntar 2 NFs da mesma placa/dia (RodoTrem/Rodocaçamba) na análise de carga */
  placa: string
  /** TMOV.IDMOV — chave interna do movimento/NF, usada para separar as notas dentro de uma "carga" (pedido do usuário 2026-08-04: "preciso saber individual [por nota], pois não cabe na carga todos estes produtos") */
  idMov: string
  /** TMOV.NUMEROMOV — número da NF para exibição */
  numeroMov: string
  /** true = entra no "m³ vendido" (produtos de menor valor como lenha/serragem ficam de fora) */
  contaM3: boolean
  m3Total: number
  m3Minimo: number
  /** m3Total × m3Minimo — usado para a média ponderada do preço mínimo no mix efetivamente vendido */
  m3PesoMinimo: number
  /** GREATEST(RECMODIFIEDON, RECCREATEDON) do Oracle — quando esta linha foi criada/editada pela última vez (usado para achar correções tardias que expliquem divergência com relatórios externos) */
  recModificadoEm: string
  /** ComputedColumn Marca ("Amaru" ou "Amaru Standard") — pedido do usuário 2026-08-13: filtro superior AMARU x STANDARD */
  marca: string
  /**
   * Faixa de diâmetro lida do nome do produto (ex. "08-10", "10-12"), a
   * partir do padrão "X 08 - 10" presente em todo produto Mourão/Peças —
   * usado na proporção 8-10/10-12 (pedido do usuário 2026-08-13). `null`
   * quando o nome não segue esse padrão.
   */
  classeDiametro: string | null
}

const REGEX_CLASSE_DIAMETRO = /X\s*(\d{2})\s*-\s*(\d{2})/

function classeDiametro(produto: string): string | null {
  const m = produto.match(REGEX_CLASSE_DIAMETRO)
  return m ? `${m[1]}-${m[2]}` : null
}

// CODTMV que participam do painel de vendas — pedido do usuário 2026-08-20:
// "Faturamento Bruto = ... (somente vendas 2.2.40 + 2.2.41)". A consulta
// Oracle traz vários outros CODTMV (2.2.44, 2.2.45, 2.2.55, 2.2.01, 2.2.02,
// 2.2.05, 2.2.10, 2.2.12, 2.2.15, 2.2.65, 2.2.07, 2.2.08) — outros tipos de
// movimento fora do escopo do faturamento (amostra, transferência, consumo
// interno etc.); ficam de fora de TODO o painel, não só do Faturamento
// Bruto (pedido do usuário: "excluir de tudo").
const CODTMV_VENDA_PADRAO = new Set(['2.2.40', '2.2.41'])
const CODTMV_BONIFICACAO_PADRAO = '2.2.48'
const CODTMV_DEVOLUCAO_PADRAO = new Set(['1.2.83', '1.2.84'])

/** Conjuntos configuráveis de `prepararVendas` — ver comentário de `PRODUTOS_FORA_DO_M3_PADRAO` acima. */
export interface ConfigVendas {
  codtmvVenda: Set<string>
  codtmvBonificacao: string
  codtmvDevolucao: Set<string>
  produtosForaDoM3: Set<string>
}

export const CONFIG_VENDAS_PADRAO: ConfigVendas = {
  codtmvVenda: CODTMV_VENDA_PADRAO,
  codtmvBonificacao: CODTMV_BONIFICACAO_PADRAO,
  codtmvDevolucao: CODTMV_DEVOLUCAO_PADRAO,
  produtosForaDoM3: PRODUTOS_FORA_DO_M3_PADRAO,
}

/** Filtra ao período (por DATASAIDA) e calcula os campos derivados de cada linha de venda. */
export function prepararVendas(rows: Row[], from: string, to: string, config: ConfigVendas = CONFIG_VENDAS_PADRAO): VendaLinha[] {
  const out: VendaLinha[] = []
  for (const r of rows) {
    const data = String(r.DATASAIDA ?? '').slice(0, 10)
    if (!data || data < from || data > to) continue

    const codtmv = String(r.CODTMV ?? '')
    if (!config.codtmvVenda.has(codtmv) && codtmv !== config.codtmvBonificacao && !config.codtmvDevolucao.has(codtmv)) continue
    const distribuidor = String(r.ABREV_DISTRIBUIDOR ?? 'SEM DISTRIBUIDOR')
    const tipoMovimentoBruto: TipoMovimento =
      config.codtmvDevolucao.has(codtmv) ? 'Devolucoes' : codtmv === config.codtmvBonificacao ? 'Bonificacoes' : 'Vendas'
    // Corrigido 2026-08-05 (pedido do usuário): o conceito de bonificação é
    // O MESMO para todos os distribuidores, sem exceção — CODTMV=2.2.48
    // sempre conta como Bonificacoes, mesmo para Planep. A regra de negócio
    // diz que Planep não deveria ter bonificação, mas se acontecer (231
    // transações reais confirmadas no Oracle), isso precisa ser CONTROLADO
    // (visível/monitorado), não escondido reclassificando como venda — ver
    // Achado 1 na aba Crítica ao modelo, que lista essas transações.
    const tipoMovimento: TipoMovimento = tipoMovimentoBruto

    const tipoProduto = String(r.TipoProduto ?? 'Agronegócio')
    const subTipoProduto = String(r.SubTipoProduto ?? 'Outros')
    const quantidade = num(r.QUANTIDADE)
    const precoVendido = num(r.PRECO_VENDIDO)
    const precoMedioTabela4 = num(r.PRECO_MEDIO_TABELA4)
    const m3Total = num(r.M3_TOTAL)
    const m3Minimo = num(r.m3_minimo)
    const flagBonificacao = String(r.BONIFICACAO ?? 'NAO').trim().toUpperCase() === 'SIM'
    // Ajuste do usuário 2026-08-24, medida DAX original:
    //   if [PRECO_VENDIDO] < [PRECO_MEDIO_TABELA4] then [PRECO_VENDIDO]
    //   else if ([PRECO_MEDIO_TABELA4] = 0 and [BONIFICACAO] = "NAO") then [PRECO_VENDIDO]
    //   else if [BONIFICACAO] = "NAO" then [PRECO_VENDIDO]
    //   else [PRECO_MEDIO_TABELA4]
    // Transcrito literalmente (mesmos 4 ramos, mesma ordem) mesmo o 2º ramo
    // sendo redundante com o 3º (BONIFICACAO="NAO" já cobre o caso, com ou
    // sem preco_medio_tabela4=0) — preserva a correspondência 1:1 com a
    // medida original em vez de "simplificar" e arriscar divergir dela.
    const precoBase = precoVendido < precoMedioTabela4
      ? precoVendido
      : precoMedioTabela4 === 0 && !flagBonificacao
        ? precoVendido
        : !flagBonificacao
          ? precoVendido
          : precoMedioTabela4
    const produto = String(r.PRODUTO ?? '').trim()

    out.push({
      data,
      mes: data.slice(0, 7),
      distribuidor,
      codDistribuidor: String(r.CODDISTRIBUIDOR ?? '').trim(),
      cliente: String(r.CLIENTE ?? '').trim(),
      produto,
      codigoPrd: String(r.CODIGOPRD ?? '').trim(),
      tipoProduto,
      subTipoProduto,
      tabelaPreco: String(r.TABELA_PRECO ?? '—'),
      tipoMovimento,
      quantidade,
      valorBruto: quantidade * precoVendido,
      desconto: num(r.DESCONTO),
      valorBonificacao: quantidade * precoVendido,
      precoMedioTabela4,
      bonificacaoOriginal: tipoMovimentoBruto === 'Bonificacoes',
      flagBonificacao,
      precoBase,
      valorBase: quantidade * precoBase,
      placa: String(r.PLACA ?? '').trim(),
      idMov: String(r.IDMOV ?? ''),
      numeroMov: String(r.NUMEROMOV ?? '').trim(),
      contaM3: !config.produtosForaDoM3.has(tipoProduto),
      m3Total,
      m3Minimo,
      m3PesoMinimo: m3Total * m3Minimo,
      recModificadoEm: String(r.RECMODIFIEDON ?? '').slice(0, 19),
      marca: String(r.Marca ?? 'Amaru'),
      classeDiametro: classeDiametro(produto),
    })
  }
  return out
}

export interface RegistroAlterado {
  data: string
  distribuidor: string
  cliente: string
  produto: string
  tipoMovimento: TipoMovimento
  quantidade: number
  valorBruto: number
  recModificadoEm: string
}

/**
 * Linhas cuja data de venda (`data`) cai dentro do período selecionado, mas
 * que foram criadas/editadas no Oracle DEPOIS do fim desse período (`to`) —
 * pedido do usuário 2026-08-04: "preciso que demonstre em algum local quais
 * os registros foram alterados agora, no detalhe, que possam estar
 * impactando esta diferença" (investigação da divergência de julho vs
 * Power BI: julho seguia recebendo lançamentos/correções em agosto). Não é
 * um diff (não temos o valor antigo, só o Oracle atual) — é uma lista de
 * "suspeitos" para conferência manual contra o relatório externo.
 */
export function registrosAlteradosAposFechamento(linhas: VendaLinha[], to: string): RegistroAlterado[] {
  const out: RegistroAlterado[] = []
  for (const l of linhas) {
    if (!l.recModificadoEm || l.recModificadoEm.slice(0, 10) <= to) continue
    out.push({
      data: l.data,
      distribuidor: l.distribuidor,
      cliente: l.cliente,
      produto: l.produto,
      tipoMovimento: l.tipoMovimento,
      quantidade: l.quantidade,
      valorBruto: l.valorBruto,
      recModificadoEm: l.recModificadoEm,
    })
  }
  return out.sort((a, b) => b.recModificadoEm.localeCompare(a.recModificadoEm))
}

export interface VendaAgregada {
  chave: string
  /**
   * Formula 1 do usuário — 2ª correção 2026-08-21 ("trazer as devoluções
   * para deduzir no líquido e não no bruto"): "(quantidade × preço unitário
   * (preco_venda)), somente vendas 2.2.40 + 2.2.41" — SEM NENHUMA dedução
   * (nem desconto, nem devolução; as duas saem só em `faturamentoLiquido`).
   * Só linhas Vendas (o CODTMV já está restrito a 2.2.40/2.2.41 desde
   * `prepararVendas`). Passou por duas versões intermediárias no mesmo dia
   * (desconto embutido aqui; depois devolução embutida aqui) antes de
   * chegar nesta — puro valorBruto, sem dedução nenhuma.
   */
  faturamentoBruto: number
  /** Soma de desconto lançado nas vendas normais do período — sem alteração de fórmula, só de contexto (agora conta só 2.2.40/2.2.41). */
  descontos: number
  /** Formula 2: descontos ÷ faturamentoBruto — null quando faturamentoBruto é zero. */
  descontosPct: number | null
  devolucoes: number
  /** Valor nominal da bonificação (quantidade × preço vendido), mantido para o que ainda usa a métrica em R$; ver `bonificacaoUnidades`/`bonificacaoM3` para a métrica física pedida na Formula 3. */
  bonificacoes: number
  /** Formula 3: total de unidades bonificadas (Σ quantidade nos movimentos de bonificação). */
  bonificacaoUnidades: number
  /** Formula 3: total de m³ bonificado (Σ M3_TOTAL nos movimentos de bonificação, mesmo critério de `contaM3` usado no m³ vendido). */
  bonificacaoM3: number
  /** Formula 5 — 2ª correção 2026-08-21: faturamentoBruto − descontos − devolução (as duas deduções acontecem aqui; faturamentoBruto agora é puro, sem nenhuma). */
  faturamentoLiquido: number
  vendasUN: number
  m3Total: number
  /**
   * faturamentoLiquidoBase ÷ m3Total — preço médio realmente praticado.
   * Continua na base de PRECO_BASE (não a nova `faturamentoBruto` de
   * preco_venda) porque foi calibrada em 2026-08-04 contra um export real
   * do Power BI (".Valor M3 Vendido") — trocar a base aqui reintroduziria a
   * divergência de R$123.069,73/mês que aquele achado corrigiu. O usuário
   * não pediu para mudar essa métrica nesta rodada (2026-08-20).
   */
  valorM3Vendido: number | null
  /**
   * "Meta de destino" — média do m3_minimo PONDERADA pelo mix efetivamente
   * vendido (m3PesoMinimo ÷ m3Total), comparável ao valorM3Vendido em
   * qualquer nível de agregação. Sem alteração de fórmula (usuário
   * confirmou 2026-08-20: "Preco Ponderado = volume m3 * m3_min"). Existiu
   * por um tempo um campo `metaDestino` separado (Σ m3PesoMinimo, um total
   * em R$ em vez de uma média por m³) implementando a Formula 9 do usuário
   * ("Meta destino = volume m³ × preço mínimo") — removido em 2026-08-21 a
   * pedido do usuário por duplicar este mesmo conceito ("realmente está
   * duplicado"); a UI usa só este campo, exibido com o rótulo "Meta de
   * destino".
   */
  precoPonderado: number | null
  /** true = valorM3Vendido abaixo do precoPonderado (perda de preço) */
  abaixoDoMinimo: boolean
  /** (precoPonderado − valorM3Vendido) × m3Total quando abaixoDoMinimo, senão 0 — quanto foi deixado de faturar por vender abaixo do mínimo esperado */
  perdaEstimada: number
  /** valorM3Vendido − precoPonderado, SEM travar em zero (negativo = perda, positivo = ganho) — usado para ranquear "melhores ganhos" e "piores perdas" com a mesma métrica */
  margem: number | null
  /**
   * "Faturamento Bruto Preço Base" na UI (renomeado 2026-08-21 — antes só
   * "Faturamento Preço Base"). Formula 6 do usuário — 2ª correção
   * 2026-08-21 (mesmo ajuste da Formula 1): "(quantidade × preço unitário
   * (preco_base)), somente vendas 2.2.40 + 2.2.41" — SEM nenhuma dedução
   * (nem desconto, nem devolução; as duas saem em
   * `faturamentoLiquidoPrecoBase`). `valorM3Vendido`/`abaixoDoMinimo`/
   * `perdaEstimada`/`margem` continuam derivando do par líquido (via
   * `faturamentoLiquidoPrecoBase`), preservando os mesmos números de
   * sempre — só o valor intermediário mostrado neste campo mudou.
   */
  faturamentoPrecoBase: number
  /**
   * "Faturamento Líquido Preço Base" — 2ª correção 2026-08-21: mesmo par
   * bruto→líquido que `faturamentoBruto`→`faturamentoLiquido`, só que na
   * base de preço_base em vez de preço_venda — `faturamentoPrecoBase`
   * (acima) menos DESCONTOS e menos DEVOLUÇÃO (avaliada a preço_base,
   * `devolucoesBase`). Numericamente é o que `valorM3Vendido` já dividia
   * por `m3Total` internamente desde sempre (calibrado contra o Power BI
   * em 2026-08-04) — inalterado por qualquer reordenação da fórmula.
   */
  faturamentoLiquidoPrecoBase: number
  /**
   * Volume que "saiu da unidade" (pedido do usuário 2026-08-13): Vendas +
   * Bonificação, descontando Devolução — diferente de `m3Total` ("Volume
   * Vendido": só Vendas − Devolução, sem bonificação). Uma bonificação
   * ocupa caminhão/expedição igual a uma venda normal, mesmo não gerando
   * receita cheia.
   */
  volumeExpedidoM3: number
}

/**
 * Agrega linhas de venda por uma chave arbitrária (distribuidor, produto,
 * tabela de preço, ou combinação) — a mesma função serve tanto para a
 * tabela detalhada quanto para totais por distribuidor.
 */
export function agregarVendas(linhas: VendaLinha[], chaveFn: (l: VendaLinha) => string): VendaAgregada[] {
  const acc = new Map<
    string,
    {
      /** Σ valorBruto (preço realmente cobrado) só em linhas Vendas — base da Formula 1 */
      valorBrutoVendas: number
      /** Σ valorBase (preço base/tabela4 quando bonificado=SIM) só em linhas Vendas — base da Formula 6 */
      valorBaseVendas: number
      descontos: number
      devolucoes: number
      /** devolução avaliada a preço_base (mesma linha da Devolucoes, valorBase em vez de valorBruto) — usada em Faturamento Bruto Preço Base */
      devolucoesBase: number
      bonificacoes: number
      bonificacaoUnidades: number
      bonificacaoM3: number
      vendasUN: number
      m3Total: number
      m3PesoMinimo: number
      /** Vendas + Bonificação − Devolução (ver `volumeExpedidoM3` acima) */
      m3TotalExpedido: number
    }
  >()
  for (const l of linhas) {
    const chave = chaveFn(l)
    const e =
      acc.get(chave) ?? {
        valorBrutoVendas: 0,
        valorBaseVendas: 0,
        descontos: 0,
        devolucoes: 0,
        devolucoesBase: 0,
        bonificacoes: 0,
        bonificacaoUnidades: 0,
        bonificacaoM3: 0,
        vendasUN: 0,
        m3Total: 0,
        m3PesoMinimo: 0,
        m3TotalExpedido: 0,
      }
    if (l.tipoMovimento === 'Devolucoes') {
      // Correção do usuário 2026-09-03: devolução e bonificação são
      // movimentos de natureza diferente e NÃO se relacionam — o casamento
      // 1:1 tentado em 2026-09-02 (ver histórico do commit 76e9cd7) foi
      // revertido a pedido do usuário ("esquece a relação entre devolução e
      // bonificação, uma não tem relação com a outra"). Uma devolução sempre
      // desconta 100% do que ela carrega — valor, m³ e quantidade — sem
      // nenhuma exceção; é a bonificação (ver ramo abaixo) que já nasce sem
      // somar em faturamento/vendasUN de venda real, então não há necessidade
      // de tratar a devolução que a reverte de forma diferente de qualquer
      // outra devolução.
      e.devolucoes += l.valorBruto
      e.devolucoesBase += l.valorBase
      e.vendasUN -= l.quantidade
      // Corrigido 2026-08-04 (releitura da nota original): a medida real do
      // Power BI (".Meta Destino") soma devolução com SINAL NEGATIVO em vez
      // de excluí-la — simétrico com o m3Total, que também subtrai devolução
      // logo abaixo. A versão anterior (excluir devolução da soma) replicava
      // ".Preço Ponderado", que é a medida assimétrica/menos correta.
      if (l.contaM3) {
        e.m3Total -= l.m3Total
        e.m3PesoMinimo -= l.m3PesoMinimo
        e.m3TotalExpedido -= l.m3Total
      }
    } else if (l.tipoMovimento === 'Bonificacoes') {
      e.bonificacoes += l.valorBonificacao
      // Formula 3 do usuário (2026-08-20): "total de unidades e m3
      // bonificado" — métrica física, não monetária.
      e.bonificacaoUnidades += l.quantidade
      if (l.contaM3) {
        e.bonificacaoM3 += l.m3Total
        e.m3TotalExpedido += l.m3Total
      }
    } else {
      e.valorBrutoVendas += l.valorBruto
      e.valorBaseVendas += l.valorBase
      e.descontos += l.desconto
      e.vendasUN += l.quantidade
      if (l.contaM3) {
        e.m3Total += l.m3Total
        e.m3PesoMinimo += l.m3PesoMinimo
        e.m3TotalExpedido += l.m3Total
      }
    }
    acc.set(chave, e)
  }

  return [...acc.entries()]
    .map(([chave, e]) => {
      // Corrigido 2026-08-21 (2ª correção do usuário no mesmo dia — "trazer
      // as devoluções para deduzir no líquido e não no bruto"): Formula 1
      // = quantidade × preço vendido, SEM nenhuma dedução — bruto de verdade.
      const faturamentoBruto = e.valorBrutoVendas
      // Formula 6: quantidade × preço base, também sem dedução.
      const faturamentoPrecoBase = e.valorBaseVendas
      // Formula 5: bruto − descontos − devolução (as duas deduções agora
      // acontecem só aqui, no líquido).
      const faturamentoLiquido = faturamentoBruto - e.descontos - e.devolucoes
      // "Faturamento Líquido Preço Base" — mesmo par bruto→líquido que
      // faturamentoBruto→faturamentoLiquido, na base de preço_base:
      // faturamentoPrecoBase − descontos − devolução (avaliada a preço_base,
      // `devolucoesBase`). Numericamente é o MESMO valor final desde a
      // primeira versão desta fórmula (valorBase − desconto − devolução,
      // goste da ordem/agrupamento que for) — mantém valorM3Vendido/
      // abaixoDoMinimo/perdaEstimada/margem calibrados contra o Power BI
      // (achado 2026-08-04).
      const faturamentoLiquidoBase = faturamentoPrecoBase - e.descontos - e.devolucoesBase
      const valorM3Vendido = e.m3Total > 0 ? faturamentoLiquidoBase / e.m3Total : null
      const precoPonderado = e.m3Total > 0 ? e.m3PesoMinimo / e.m3Total : null
      const abaixoDoMinimo = valorM3Vendido != null && precoPonderado != null && valorM3Vendido < precoPonderado
      return {
        chave,
        faturamentoBruto,
        descontos: e.descontos,
        descontosPct: faturamentoBruto !== 0 ? e.descontos / faturamentoBruto : null,
        devolucoes: e.devolucoes,
        bonificacoes: e.bonificacoes,
        bonificacaoUnidades: e.bonificacaoUnidades,
        bonificacaoM3: e.bonificacaoM3,
        faturamentoLiquido,
        vendasUN: e.vendasUN,
        m3Total: e.m3Total,
        valorM3Vendido,
        precoPonderado,
        abaixoDoMinimo,
        perdaEstimada: abaixoDoMinimo ? (precoPonderado! - valorM3Vendido!) * e.m3Total : 0,
        margem: valorM3Vendido != null && precoPonderado != null ? valorM3Vendido - precoPonderado : null,
        faturamentoPrecoBase,
        faturamentoLiquidoPrecoBase: faturamentoLiquidoBase,
        volumeExpedidoM3: e.m3TotalExpedido,
      }
    })
    .sort((a, b) => b.faturamentoLiquido - a.faturamentoLiquido)
}

/**
 * Formula 7 do usuário — corrigida 2026-08-21 ("Bonificação gerada no mês =
 * faturamento líquido − faturamento preço base × 0,7142, bonificado = SIM";
 * a versão de 2026-08-20 dizia "faturamento bruto", sem descontar
 * devolução). Métrica de topo, calculada uma vez sobre TODAS as linhas do
 * período (não por chave de agrupamento) — escopo confirmado pelo usuário:
 * só linhas com `flagBonificacao` (TMOVCOMPL.BONIFICACAO='SIM'),
 * independente do `tipoMovimento`/CODTMV da linha (a flag aparece inclusive
 * em vendas normais — achado 2026-08-04). "Faturamento líquido" aqui é o
 * bruto do subconjunto (Formula 1, líquido de desconto) menos a devolução
 * DESSE MESMO subconjunto — mesma relação bruto→líquido da Formula 5,
 * restrita às linhas bonificado=SIM.
 *
 * Correção do usuário 2026-08-31: fórmula passa a ser (líquido − base) ×
 * fator (era líquido − base×fator), e o fator passa a variar por
 * mês/ano — `resolverFator(mes)` resolve o valor certo pra cada mês
 * tocado pelo período (ver `resolverFatorBonificacao` em
 * `src/lib/fase3/cotas.ts`). Quando `linhas` cobre mais de um mês, cada
 * mês usa o SEU fator (não um fator único pro período todo) — soma dos
 * resultados mensais.
 */
export function calcularBonificacaoDoMes(linhas: VendaLinha[], resolverFator: (mes: string) => number): number {
  const porMes = new Map<string, { bruto: number; devolucao: number; base: number }>()
  for (const l of linhas) {
    if (!l.flagBonificacao) continue
    const acc = porMes.get(l.mes) ?? { bruto: 0, devolucao: 0, base: 0 }
    if (l.tipoMovimento === 'Devolucoes') {
      acc.devolucao += l.valorBruto
    } else {
      acc.bruto += l.valorBruto - l.desconto
      acc.base += l.valorBase - l.desconto
    }
    porMes.set(l.mes, acc)
  }
  let total = 0
  for (const [mes, { bruto, devolucao, base }] of porMes) {
    const liquido = bruto - devolucao
    total += (liquido - base) * resolverFator(mes)
  }
  return total
}

export interface MesProduto {
  mes: string
  valorM3Vendido: number | null
  precoPonderado: number | null
  abaixoDoMinimo: boolean
  perdaEstimada: number
}

export interface ProdutoAoLongoDoTempo {
  produto: string
  faturamentoLiquido: number
  meses: MesProduto[]
  /** meses com m³ vendido no período (meses sem venda do produto não contam nem a favor nem contra) */
  mesesComVenda: number
  mesesComPerda: number
  mesesOk: number
}

/**
 * Desempenho de cada produto mês a mês (pedido do usuário 2026-08-04: "ver
 * os produtos que geraram perdas ao longo do tempo, produtos que em meses
 * tiveram boa performance"). Reaproveita agregarVendas agrupando por
 * mês+produto e depois recompõe por produto, ordenado pelos que mais
 * acumularam meses abaixo do preço mínimo primeiro.
 */
export function produtosAoLongoDoTempo(linhas: VendaLinha[]): ProdutoAoLongoDoTempo[] {
  const porMesProduto = agregarVendas(linhas, (l) => `${l.mes}|${l.produto}`)

  const porProduto = new Map<string, { faturamentoLiquido: number; meses: MesProduto[] }>()
  for (const a of porMesProduto) {
    const [mes, produto] = a.chave.split('|')
    const e = porProduto.get(produto) ?? { faturamentoLiquido: 0, meses: [] }
    e.faturamentoLiquido += a.faturamentoLiquido
    e.meses.push({
      mes,
      valorM3Vendido: a.valorM3Vendido,
      precoPonderado: a.precoPonderado,
      abaixoDoMinimo: a.abaixoDoMinimo,
      perdaEstimada: a.perdaEstimada,
    })
    porProduto.set(produto, e)
  }

  return [...porProduto.entries()]
    .map(([produto, e]) => {
      const meses = e.meses.sort((x, y) => x.mes.localeCompare(y.mes))
      const comVenda = meses.filter((m) => m.valorM3Vendido != null)
      const mesesComPerda = comVenda.filter((m) => m.abaixoDoMinimo).length
      return {
        produto,
        faturamentoLiquido: e.faturamentoLiquido,
        meses,
        mesesComVenda: comVenda.length,
        mesesComPerda,
        mesesOk: comVenda.length - mesesComPerda,
      }
    })
    .sort((a, b) => b.mesesComPerda - a.mesesComPerda || b.faturamentoLiquido - a.faturamentoLiquido)
}

export interface CargaProduto {
  produto: string
  quantidade: number
  m3Total: number
  valorBruto: number
}

export interface CargaNota {
  numeroMov: string
  cliente: string
  m3Total: number
  faturamentoBruto: number
  produtos: CargaProduto[]
}

export interface Carga {
  chave: string
  placa: string
  data: string
  /**
   * nº de LINHAS/ITENS de produto somados de todas as NFs desta carga — NÃO
   * é o número de notas fiscais (uma única NF já costuma ter vários produtos
   * diferentes). Para o número real de NFs distintas, usar `notas.length`.
   * BUG encontrado 2026-08-04: essa confusão fazia uma carga de 1 NF com 10
   * produtos parecer "10 NFs mescladas" na tela, quando é 1 NF só.
   */
  numLinhas: number
  distribuidor: string
  cliente: string
  tipoProdutoPrincipal: string
  /** Mourão/Peças (ou outro SubTipoProduto) predominante nesta carga, por m³ — pedido original: comparar Mourão x Peças */
  subTipoProdutoPrincipal: string
  tabelaPreco: string
  m3Total: number
  faturamentoBruto: number
  valorM3: number | null
  precoPonderado: number | null
  abaixoDoMinimo: boolean
  /** produtos que compõem esta carga, por m³ — pedido do usuário 2026-08-04: "nas melhores cargas precisa abrir para ver o detalhe, qual a carga e quais produtos" */
  produtos: CargaProduto[]
  /**
   * Notas (NFs) individuais que foram mescladas nesta carga — pedido do
   * usuário 2026-08-04: "veja que mostram 10 cargas [NFs], preciso saber
   * individual pois não cabe na carga todos estes produtos". Uma carga com
   * muitas NFs (mais que as 2 esperadas de RodoTrem/Rodocaçamba) pode ser,
   * na verdade, várias entregas distintas da mesma placa no mesmo dia — não
   * uma carga física única — por isso ver cada NF separada é importante.
   */
  notas: CargaNota[]
}

/**
 * Junta linhas de venda da MESMA placa no MESMO dia numa única "carga"
 * (pedido do usuário 2026-08-04: "se tiver mais de uma nota para a mesma
 * placa no mesmo dia, juntar as duas notas na análise pois rodotrem ou
 * rodocaçamba precisam de duas notas") — sem isso, uma carga de RodoTrem
 * (2 NFs) apareceria como duas vendas menores em vez de uma carga só, e a
 * comparação de preço/m³ por carga ficaria distorcida. Só considera linhas
 * de Vendas (devolução/bonificação não formam "carga"). Linhas sem PLACA
 * (a maioria histórica, sincronizada antes da coluna existir, ou vendas
 * sem transporte próprio) ficam de fora — aparecem em `linhasSemPlaca`.
 */
export function agruparCargas(linhas: VendaLinha[]): { cargas: Carga[]; linhasSemPlaca: number } {
  const acc = new Map<
    string,
    {
      placa: string
      data: string
      numLinhas: number
      distribuidor: string
      cliente: string
      m3PorTipoProduto: Map<string, number>
      m3PorSubTipoProduto: Map<string, number>
      produtos: Map<string, { quantidade: number; m3Total: number; valorBruto: number }>
      notas: Map<string, { numeroMov: string; cliente: string; m3Total: number; faturamentoBruto: number; produtos: Map<string, { quantidade: number; m3Total: number; valorBruto: number }> }>
      tabelasPreco: Set<string>
      m3Total: number
      faturamentoBruto: number
      m3PesoMinimo: number
    }
  >()
  let linhasSemPlaca = 0
  for (const l of linhas) {
    if (l.tipoMovimento !== 'Vendas') continue
    if (!l.placa) {
      linhasSemPlaca++
      continue
    }
    const chave = `${l.placa}|${l.data}`
    const e = acc.get(chave) ?? {
      placa: l.placa,
      data: l.data,
      numLinhas: 0,
      distribuidor: l.distribuidor,
      cliente: l.cliente,
      m3PorTipoProduto: new Map<string, number>(),
      m3PorSubTipoProduto: new Map<string, number>(),
      produtos: new Map<string, { quantidade: number; m3Total: number; valorBruto: number }>(),
      notas: new Map(),
      tabelasPreco: new Set<string>(),
      m3Total: 0,
      faturamentoBruto: 0,
      m3PesoMinimo: 0,
    }
    e.numLinhas++
    e.tabelasPreco.add(l.tabelaPreco)
    // valorBase (não valorBruto) pelo mesmo motivo de agregarVendas — ver
    // comentário lá (achado 2026-08-04: desconto embutido via flag bruto
    // BONIFICACAO, independente do CODTMV).
    e.faturamentoBruto += l.valorBase - l.desconto
    const p = e.produtos.get(l.produto) ?? { quantidade: 0, m3Total: 0, valorBruto: 0 }
    p.quantidade += l.quantidade
    p.m3Total += l.m3Total
    p.valorBruto += l.valorBase - l.desconto
    e.produtos.set(l.produto, p)

    const notaChave = l.idMov || l.numeroMov
    const nota = e.notas.get(notaChave) ?? { numeroMov: l.numeroMov, cliente: l.cliente, m3Total: 0, faturamentoBruto: 0, produtos: new Map<string, { quantidade: number; m3Total: number; valorBruto: number }>() }
    nota.m3Total += l.m3Total
    nota.faturamentoBruto += l.valorBase - l.desconto
    const np = nota.produtos.get(l.produto) ?? { quantidade: 0, m3Total: 0, valorBruto: 0 }
    np.quantidade += l.quantidade
    np.m3Total += l.m3Total
    np.valorBruto += l.valorBase - l.desconto
    nota.produtos.set(l.produto, np)
    e.notas.set(notaChave, nota)

    if (l.contaM3) {
      e.m3Total += l.m3Total
      e.m3PesoMinimo += l.m3PesoMinimo
      e.m3PorTipoProduto.set(l.tipoProduto, (e.m3PorTipoProduto.get(l.tipoProduto) ?? 0) + l.m3Total)
      e.m3PorSubTipoProduto.set(l.subTipoProduto, (e.m3PorSubTipoProduto.get(l.subTipoProduto) ?? 0) + l.m3Total)
    }
    acc.set(chave, e)
  }

  const cargas = [...acc.entries()].map(([chave, e]) => {
    const valorM3 = e.m3Total > 0 ? e.faturamentoBruto / e.m3Total : null
    const precoPonderado = e.m3Total > 0 ? e.m3PesoMinimo / e.m3Total : null
    const tipoProdutoPrincipal =
      [...e.m3PorTipoProduto.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'
    const subTipoProdutoPrincipal =
      [...e.m3PorSubTipoProduto.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'
    const produtos = [...e.produtos.entries()]
      .map(([produto, p]) => ({ produto, quantidade: p.quantidade, m3Total: p.m3Total, valorBruto: p.valorBruto }))
      .sort((a, b) => b.m3Total - a.m3Total)
    const notas = [...e.notas.values()]
      .map((n) => ({
        numeroMov: n.numeroMov,
        cliente: n.cliente,
        m3Total: n.m3Total,
        faturamentoBruto: n.faturamentoBruto,
        produtos: [...n.produtos.entries()]
          .map(([produto, p]) => ({ produto, quantidade: p.quantidade, m3Total: p.m3Total, valorBruto: p.valorBruto }))
          .sort((a, b) => b.m3Total - a.m3Total),
      }))
      .sort((a, b) => a.numeroMov.localeCompare(b.numeroMov))
    return {
      chave,
      placa: e.placa,
      data: e.data,
      numLinhas: e.numLinhas,
      distribuidor: e.distribuidor,
      cliente: e.cliente,
      tipoProdutoPrincipal,
      subTipoProdutoPrincipal,
      tabelaPreco: e.tabelasPreco.size === 1 ? [...e.tabelasPreco][0] : 'Múltiplas',
      m3Total: e.m3Total,
      faturamentoBruto: e.faturamentoBruto,
      valorM3,
      precoPonderado,
      abaixoDoMinimo: valorM3 != null && precoPonderado != null && valorM3 < precoPonderado,
      produtos,
      notas,
    }
  })

  return { cargas, linhasSemPlaca }
}

export interface TransacaoPreco {
  numeroMov: string
  data: string
  distribuidor: string
  cliente: string
  preco: number
}

export interface DispersaoPreco {
  produto: string
  tabelaPreco: string
  n: number
  precoMin: number
  precoMax: number
  precoMedio: number
  /** (precoMax - precoMin) / precoMedio — quanto o preço varia dentro da mesma alíquota de ICMS para o mesmo produto */
  variacaoPct: number
  /**
   * Transação (NF/cliente/data) que praticou o preço mínimo e o máximo —
   * pedido do usuário 2026-08-21: "preciso ter uma seta para detalhar para
   * saber o cliente e nota do maior preço e menor preço, colocar a opção de
   * clicar e já abrir a nota completa na aba por nf". `null` só no caso
   * teórico de `n === 0` (não deveria acontecer, já filtrado por `minVendas`).
   */
  notaMin: TransacaoPreco | null
  notaMax: TransacaoPreco | null
}

/**
 * Para cada produto × tabela de ICMS, mede o quanto o PRECO_VENDIDO varia
 * entre as vendas (pedido do usuário 2026-08-04: "mostrar produtos que têm
 * um valor considerável de preço entre as vendas de acordo com cada
 * alíquota de ICMS") — um produto vendido pela mesma alíquota a preços
 * muito diferentes é candidato a inconsistência comercial (desconto informal,
 * erro de tabela, etc.), não só perda de preço médio.
 */
export function dispersaoPrecoPorProdutoTabela(linhas: VendaLinha[], minVendas = 3): DispersaoPreco[] {
  const acc = new Map<string, { transacoes: TransacaoPreco[] }>()
  for (const l of linhas) {
    if (l.tipoMovimento !== 'Vendas' || l.quantidade <= 0) continue
    const precoUnitario = l.valorBruto / l.quantidade
    if (!Number.isFinite(precoUnitario) || precoUnitario <= 0) continue
    const chave = `${l.produto}|${l.tabelaPreco}`
    const e = acc.get(chave) ?? { transacoes: [] }
    e.transacoes.push({ numeroMov: l.numeroMov, data: l.data, distribuidor: l.distribuidor, cliente: l.cliente, preco: precoUnitario })
    acc.set(chave, e)
  }

  return [...acc.entries()]
    .filter(([, e]) => e.transacoes.length >= minVendas)
    .map(([chave, e]) => {
      const [produto, tabelaPreco] = chave.split('|')
      const precoMin = Math.min(...e.transacoes.map((t) => t.preco))
      const precoMax = Math.max(...e.transacoes.map((t) => t.preco))
      const precoMedio = e.transacoes.reduce((s, t) => s + t.preco, 0) / e.transacoes.length
      return {
        produto,
        tabelaPreco,
        n: e.transacoes.length,
        precoMin,
        precoMax,
        precoMedio,
        variacaoPct: precoMedio > 0 ? (precoMax - precoMin) / precoMedio : 0,
        notaMin: e.transacoes.find((t) => t.preco === precoMin) ?? null,
        notaMax: e.transacoes.find((t) => t.preco === precoMax) ?? null,
      }
    })
    .sort((a, b) => b.variacaoPct - a.variacaoPct)
}

export interface VendaAbaixoTabela4 {
  data: string
  distribuidor: string
  cliente: string
  produto: string
  tabelaPreco: string
  quantidade: number
  /** preço LÍQUIDO de desconto (valorBruto − desconto) ÷ quantidade — pedido do usuário 2026-08-05: "o preço de venda nunca pode ser menor do que o preço da tabela 4, considerar o desconto para esta comparação" */
  precoVendido: number
  precoMedioTabela4: number
  diferenca: number
  valorPerdido: number
}

/**
 * Transações de VENDA NORMAL (devolução e bonificação não entram — ver
 * RESPOSTA do usuário 2026-08-04 na nota Fase 3: "As vendas do tipo
 * bonificação nunca entra na analise") onde o preço realmente cobrado ficou
 * abaixo do preço de tabela do distribuidor (pedido original da nota Fase 3:
 * "demonstrar quando preco_base ou preco_venda for menor do que
 * PRECO_MEDIO_TABELA4"). Nunca implementado até 2026-08-04. Quando não existe
 * tabela de distribuidor vigente, `PRECO_MEDIO_TABELA4` cai no próprio preço
 * vendido — a comparação nunca dispara nesse caso (não é uma perda, é a
 * ausência de referência). Usa `bonificacaoOriginal` para excluir bonificação
 * formal (CODTMV=2.2.48) da análise.
 *
 * Corrigido 2026-08-05 (regra do usuário: "o preço de venda nunca pode ser
 * menor do que o preço da tabela 4, considerar o desconto para esta
 * comparação"): o preço comparado é o LÍQUIDO de desconto
 * ((valorBruto − desconto) ÷ quantidade), não o preço unitário bruto —
 * antes o desconto não entrava nessa conta, então uma venda com desconto
 * poderia estar de fato abaixo da tabela 4 sem o painel apontar.
 */
export function vendasAbaixoTabela4(linhas: VendaLinha[]): VendaAbaixoTabela4[] {
  const out: VendaAbaixoTabela4[] = []
  for (const l of linhas) {
    if (l.tipoMovimento === 'Devolucoes' || l.bonificacaoOriginal || l.quantidade <= 0) continue
    const precoVendido = (l.valorBruto - l.desconto) / l.quantidade
    if (precoVendido >= l.precoMedioTabela4) continue
    out.push({
      data: l.data,
      distribuidor: l.distribuidor,
      cliente: l.cliente,
      produto: l.produto,
      tabelaPreco: l.tabelaPreco,
      quantidade: l.quantidade,
      precoVendido,
      precoMedioTabela4: l.precoMedioTabela4,
      diferenca: l.precoMedioTabela4 - precoVendido,
      valorPerdido: (l.precoMedioTabela4 - precoVendido) * l.quantidade,
    })
  }
  return out.sort((a, b) => b.valorPerdido - a.valorPerdido)
}

export interface BonificacaoSemTabela4 {
  data: string
  distribuidor: string
  cliente: string
  produto: string
  quantidade: number
  precoVendido: number
  valorBonificacao: number
}

/**
 * Bonificações (BONIFICACAO='SIM' na origem — `bonificacaoOriginal`, inclui
 * a Planep) onde NÃO existe uma tabela de distribuidor vigente para calcular
 * o valor real bonificado. RESPOSTA do usuário 2026-08-04: "as vendas que tem
 * o campo como SIM, sempre devem utilizar e ter uma tabela4, caso não tenha
 * precisa apontar, pois isto quer dizer que aquele cliente vai ter um valor
 * bonificado e ele é a diferença do preço de venda e o preço da tabela4 ...
 * que vamos sempre comparar com o preco_minimo". Sem uma tabela4 real, o
 * `PRECO_MEDIO_TABELA4` cai no próprio preço vendido (fallback do CASE na
 * consulta Oracle) — ou seja, `precoMedioTabela4 === precoVendido` é
 * exatamente o sinal de "sem tabela4", sem precisar de uma coluna nova na
 * consulta.
 */
export function bonificacoesSemTabela4(linhas: VendaLinha[]): BonificacaoSemTabela4[] {
  const out: BonificacaoSemTabela4[] = []
  for (const l of linhas) {
    if (!l.bonificacaoOriginal || l.quantidade <= 0) continue
    const precoVendido = l.valorBruto / l.quantidade
    if (Math.abs(l.precoMedioTabela4 - precoVendido) > 0.005) continue
    out.push({
      data: l.data,
      distribuidor: l.distribuidor,
      cliente: l.cliente,
      produto: l.produto,
      quantidade: l.quantidade,
      precoVendido,
      valorBonificacao: l.valorBonificacao,
    })
  }
  return out.sort((a, b) => b.valorBonificacao - a.valorBonificacao)
}

/** "YYYY-MM" -> índice absoluto de mês (para subtrair/comparar sem parsear datas) */
function mesIndice(mes: string): number {
  const [ano, m] = mes.split('-').map(Number)
  return ano * 12 + (m - 1)
}

export interface ClienteHistorico {
  cliente: string
  mesesComCompra: number
  ultimoMes: string
  faturamentoTotal: number
  /** comprou em pelo menos 3 meses distintos nos últimos 12 meses antes de `mesReferencia` */
  recorrente: boolean
  /** recorrente, mas sem nenhuma compra nos últimos 2 meses completos antes de `mesReferencia` */
  parado: boolean
  /** faturamento dos últimos 3 meses caiu 30%+ vs. os 3 meses anteriores */
  emQueda: boolean
  faturamentoUltimos3Meses: number
  faturamentoAnteriores3Meses: number
  /** meses completos desde a última compra até `mesReferencia` */
  mesesSemComprar: number
  /** já comprou alguma vez e está sem comprar há 6+ meses — independe de ser "recorrente" (pedido do usuário 2026-08-04: "clientes que eram compradores e deixaram de comprar do início do negócio para cá", para busca de clientes potenciais) */
  inativo: boolean
  /**
   * Faturamento mês a mês (YYYY-MM), do primeiro ao último mês com compra —
   * pedido do usuário 2026-08-04: "dar a opção de clicar e detalhar melhor
   * o faturamento total em quanto tempo, abrir os meses que estão em
   * comprar e não só a etiqueta de 3 meses". Ordenado cronologicamente.
   */
  historicoMensal: { mes: string; faturamento: number }[]
}

/**
 * Pedido original da nota Fase 3, nunca implementado: "clientes que tendem a
 * reduzir volume de compra, clientes que tem compras recorrentes e ficaram
 * um tempo sem comprar". Critérios (🔶 decisão pendente na nota — assumidos
 * como padrão razoável até o usuário confirmar/ajustar): recorrente = 3+
 * meses distintos de compra nos últimos 12; parado = recorrente sem comprar
 * nos últimos 2 meses fechados; em queda = últimos 3 meses 30%+ abaixo dos 3
 * meses anteriores. `mesReferencia` (YYYY-MM) é o mês mais recente a
 * considerar como "hoje" — normalmente o mês corrente.
 */
export function analisarClientes(linhas: VendaLinha[], mesReferencia: string): ClienteHistorico[] {
  const refIdx = mesIndice(mesReferencia)
  const porCliente = new Map<string, Map<string, number>>()
  for (const l of linhas) {
    if (l.tipoMovimento !== 'Vendas') continue
    const cliente = l.cliente || '—'
    const meses = porCliente.get(cliente) ?? new Map<string, number>()
    meses.set(l.mes, (meses.get(l.mes) ?? 0) + l.valorBruto - l.desconto)
    porCliente.set(cliente, meses)
  }

  const out: ClienteHistorico[] = []
  for (const [cliente, meses] of porCliente.entries()) {
    const mesesOrdenados = [...meses.keys()].sort()
    const ultimoMes = mesesOrdenados[mesesOrdenados.length - 1]
    const mesesUltimos12 = [...meses.entries()].filter(([mes]) => refIdx - mesIndice(mes) < 12 && refIdx - mesIndice(mes) >= 0)
    const recorrente = mesesUltimos12.length >= 3
    const mesesDesdeUltimaCompra = refIdx - mesIndice(ultimoMes)
    const parado = recorrente && mesesDesdeUltimaCompra > 2

    let faturamentoUltimos3Meses = 0
    let faturamentoAnteriores3Meses = 0
    for (const [mes, valor] of meses.entries()) {
      const delta = refIdx - mesIndice(mes)
      if (delta >= 0 && delta < 3) faturamentoUltimos3Meses += valor
      else if (delta >= 3 && delta < 6) faturamentoAnteriores3Meses += valor
    }
    const emQueda = faturamentoAnteriores3Meses > 0 && faturamentoUltimos3Meses < faturamentoAnteriores3Meses * 0.7

    out.push({
      cliente,
      mesesComCompra: mesesOrdenados.length,
      ultimoMes,
      faturamentoTotal: [...meses.values()].reduce((s, v) => s + v, 0),
      recorrente,
      parado,
      emQueda,
      faturamentoUltimos3Meses,
      faturamentoAnteriores3Meses,
      mesesSemComprar: mesesDesdeUltimaCompra,
      inativo: mesesDesdeUltimaCompra >= 6,
      historicoMensal: mesesOrdenados.map((mes) => ({ mes, faturamento: meses.get(mes) ?? 0 })),
    })
  }

  return out.sort((a, b) => (Number(b.parado) - Number(a.parado)) || (Number(b.emQueda) - Number(a.emQueda)) || b.faturamentoTotal - a.faturamentoTotal)
}
