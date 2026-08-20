import { prisma } from '@/lib/prisma'

function normPlaca(v: unknown): string {
  return String(v ?? '').trim().toUpperCase()
}

/**
 * Resolve a composição (implemento) vigente de uma placa em uma data.
 * Regra: registro com effectiveFrom NULL é a composição de cadastro (vale
 * desde sempre); cada mudança vale a partir da sua data. Vence o registro
 * mais recente com effectiveFrom <= data da viagem.
 * Retorna null quando a placa não tem cadastro (o chamador usa o fallback —
 * hoje, a coluna condicional migrada do PowerQuery).
 */
export async function buildCompositionResolver(): Promise<
  (placa: unknown, dateYmd: string) => string | null
> {
  const records = await prisma.plateComposition.findMany({
    orderBy: [{ placa: 'asc' }, { effectiveFrom: 'asc' }],
  })

  const byPlaca = new Map<string, { from: string | null; composition: string }[]>()
  for (const r of records) {
    const key = normPlaca(r.placa)
    const list = byPlaca.get(key) ?? []
    list.push({
      from: r.effectiveFrom ? r.effectiveFrom.toISOString().slice(0, 10) : null,
      composition: r.composition,
    })
    byPlaca.set(key, list)
  }
  // ordena: cadastro (null) primeiro, depois mudanças por data crescente
  for (const list of byPlaca.values()) {
    list.sort((a, b) => (a.from ?? '').localeCompare(b.from ?? ''))
  }

  return (placa: unknown, dateYmd: string) => {
    const list = byPlaca.get(normPlaca(placa))
    if (!list || list.length === 0) return null
    let current: string | null = null
    for (const r of list) {
      if (r.from === null || r.from <= dateYmd) current = r.composition
      else break
    }
    return current
  }
}

/**
 * Composição vigente de cada placa cadastrada HOJE, com a data de vigência
 * do registro atual ("desde quando") — usado tanto pelo Fase1 (pra excluir
 * placas fora de escopo, ex.: Tritrem Florestal) quanto pelo Fase5
 * (Transporte Interno de Madeira, pra saber quais placas acompanhar).
 */
export async function composicoesAtuaisComDesde(
  resolveComposition: (placa: unknown, dateYmd: string) => string | null,
): Promise<Record<string, { composicao: string; desde: string | null }>> {
  const todayStr = new Date().toISOString().slice(0, 10)
  const registros = await prisma.plateComposition.findMany({
    orderBy: { effectiveFrom: 'asc' },
    select: { placa: true, effectiveFrom: true },
  })
  const composicoesAtuais: Record<string, { composicao: string; desde: string | null }> = {}
  for (const placa of new Set(registros.map((p) => normPlaca(p.placa)))) {
    const composicao = resolveComposition(placa, todayStr)
    if (!composicao) continue
    // Data de vigência do registro atual — mesma lógica de resolução do
    // resolver (o registro com effectiveFrom mais recente ainda <= hoje;
    // null conta como "desde sempre", só perde pra qualquer data real) —
    // usado só pra exibir "desde quando" ao usuário.
    const registrosDaPlaca = registros
      .filter((r) => normPlaca(r.placa) === placa)
      .map((r) => (r.effectiveFrom ? r.effectiveFrom.toISOString().slice(0, 10) : null))
      .sort((a, b) => (a ?? '').localeCompare(b ?? ''))
    let desde: string | null = null
    for (const from of registrosDaPlaca) {
      if (from === null || from <= todayStr) desde = from
      else break
    }
    composicoesAtuais[placa] = { composicao, desde }
  }
  return composicoesAtuais
}

type Row = Record<string, unknown>

// Composições que legitimamente puxam 2+ semirreboques (logo, geram 2+ notas
// fiscais agrupadas na mesma viagem) — achado real 2026-08-20, caso TAK5C13:
// "iniciou como LS 4 eixos e alterou para tri trem, no entanto quando altero
// ele esta gerando inconsistência". A regra abaixo nasceu quando só existia
// RodoTrem (2 reboques) na frota; com o Tritrem Florestal (3 unidades) agora
// cadastrado, ele também é multi-nota legítimo — sem essa lista, qualquer
// placa recém-migrada pra Tritrem passava a ser sinalizada como inconsistente
// (e tinha seu TipoComposição sobrescrito de volta pra "RodoTrem", errado).
const COMPOSICOES_MULTI_REBOQUE = new Set(['RodoTrem', 'Tritrem Florestal'])

/**
 * Sobrepõe a composição resolvida (cadastro de placa / coluna condicional)
 * com duas fontes mais fortes de evidência:
 *  1. Rota com composição fixa (ex.: trecho interno sempre feito de Tritrem) —
 *     um fato operacional da rota, cadastrado em Rotas.
 *  2. Viagem com 2+ notas fiscais agrupadas (MOVIMENTOS >= 2): evidência de
 *     um implemento multi-reboque (RodoTrem ou Tritrem Florestal) — a
 *     evidência mais concreta (o que realmente rodou naquele dia), por isso
 *     tem a palavra final mesmo sobre a rota fixa. Quando o cadastro já diz
 *     qual dos dois é, usa o cadastro (não força RodoTrem por padrão).
 *
 * Além de resolver a composição, marca COMPOSICAO_INCONSISTENTE quando a
 * evidência das notas não bate com o cadastro: 3+ notas no mesmo agrupamento
 * (nenhum implemento cadastrado hoje justifica isso) ou 2 notas numa placa
 * cadastrada com uma composição de reboque único.
 */
export function applyCompositionOverrides(
  trips: Row[],
  matchRoute: (row: Row) => { fixedComposition: string | null } | null,
): Row[] {
  return trips.map((trip) => {
    const route = matchRoute(trip)
    // Composição que a viagem teria SEM a evidência das 2+ notas — cadastro
    // de placa ou composição fixa da rota. Serve para detectar inconsistência
    // logo abaixo (placa que não é multi-reboque, mas apareceu com 2+ notas).
    const composicaoCadastrada = route?.fixedComposition || trip['TipoComposição']
    let composition = composicaoCadastrada
    const numNotas = Number(trip.MOVIMENTOS ?? 1)
    const duasOuMaisNotas = numNotas >= 2
    const cadastradaEhMultiReboque = !!composicaoCadastrada && COMPOSICOES_MULTI_REBOQUE.has(composicaoCadastrada as string)
    // Só sobrescreve pra "RodoTrem" quando o cadastro NÃO é nenhum dos
    // multi-reboque conhecidos (sem cadastro, ou cadastro de reboque único) —
    // se já é Tritrem Florestal, mantém Tritrem Florestal.
    if (duasOuMaisNotas && !cadastradaEhMultiReboque) composition = 'RodoTrem'
    // Inconsistência quando:
    //  - 3+ notas no mesmo dia/placa/motorista/destino: SEMPRE suspeito,
    //    nenhum implemento cadastrado hoje puxa 3+ reboques na mesma viagem
    //    (pedido do usuário 2026-07-29, caso SES5B33: 3 notas, 72,4t).
    //  - exatamente 2 notas mas o cadastro diz que a placa TEM uma composição
    //    de reboque único (não é RodoTrem nem Tritrem Florestal) — sem
    //    cadastro (null/undefined), não dá para afirmar nada, então não marca.
    //  - só 1 nota, mas a placa está cadastrada como RodoTrem: o RodoTrem
    //    sempre puxa dois semirreboques, então sempre precisa emitir duas
    //    notas na mesma viagem — 1 nota é evidência de que o cadastro está
    //    desatualizado ou a viagem não usou de fato o RodoTrem (pedido do
    //    usuário 2026-08-03). Não se aplica ao Tritrem Florestal — sem
    //    confirmação de que ele sempre emite mais de 1 nota, não assume.
    const inconsistente =
      numNotas >= 3 ||
      (duasOuMaisNotas && !!composicaoCadastrada && !cadastradaEhMultiReboque) ||
      (!duasOuMaisNotas && composicaoCadastrada === 'RodoTrem')
    return {
      ...trip,
      ...(composition === trip['TipoComposição'] ? {} : { ['TipoComposição']: composition }),
      COMPOSICAO_CADASTRADA: composicaoCadastrada ?? null,
      COMPOSICAO_INCONSISTENTE: inconsistente,
    }
  })
}
