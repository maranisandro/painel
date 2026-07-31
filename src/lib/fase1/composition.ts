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

type Row = Record<string, unknown>

/**
 * Sobrepõe a composição resolvida (cadastro de placa / coluna condicional)
 * com duas fontes mais fortes de evidência:
 *  1. Rota com composição fixa (ex.: trecho interno sempre feito de Tritrem) —
 *     um fato operacional da rota, cadastrado em Rotas.
 *  2. Viagem com 2+ notas fiscais agrupadas (MOVIMENTOS >= 2): sempre
 *     RodoTrem, pois só este implemento puxa dois semirreboques na mesma
 *     viagem — é a evidência mais concreta (o que realmente rodou naquele
 *     dia), por isso tem a palavra final mesmo sobre a rota fixa.
 *
 * Além de resolver a composição, marca COMPOSICAO_INCONSISTENTE quando a
 * evidência das notas não bate com o cadastro: 3+ notas no mesmo agrupamento
 * (nem o RodoTrem, que só tem 2 reboques, justifica isso) ou 2 notas numa
 * placa cadastrada com outra composição.
 */
export function applyCompositionOverrides(
  trips: Row[],
  matchRoute: (row: Row) => { fixedComposition: string | null } | null,
): Row[] {
  return trips.map((trip) => {
    const route = matchRoute(trip)
    // Composição que a viagem teria SEM a evidência das 2+ notas — cadastro
    // de placa ou composição fixa da rota. Serve para detectar inconsistência
    // logo abaixo (placa que não é RodoTrem, mas apareceu com 2+ notas).
    const composicaoCadastrada = route?.fixedComposition || trip['TipoComposição']
    let composition = composicaoCadastrada
    const numNotas = Number(trip.MOVIMENTOS ?? 1)
    const duasOuMaisNotas = numNotas >= 2
    if (duasOuMaisNotas) composition = 'RodoTrem'
    // Inconsistência quando:
    //  - 3+ notas no mesmo dia/placa/motorista/destino: SEMPRE suspeito,
    //    mesmo que a placa já seja RodoTrem — o RodoTrem só puxa 2
    //    semirreboques, então uma 3ª nota não pode ser a mesma viagem física
    //    (pedido do usuário 2026-07-29, caso SES5B33: 3 notas, 72,4t).
    //  - exatamente 2 notas mas o cadastro diz que a placa TEM uma composição
    //    diferente de RodoTrem — sem cadastro (null/undefined), não dá para
    //    afirmar nada, então não marca.
    const inconsistente =
      numNotas >= 3 || (duasOuMaisNotas && !!composicaoCadastrada && composicaoCadastrada !== 'RodoTrem')
    return {
      ...trip,
      ...(composition === trip['TipoComposição'] ? {} : { ['TipoComposição']: composition }),
      COMPOSICAO_CADASTRADA: composicaoCadastrada ?? null,
      COMPOSICAO_INCONSISTENTE: inconsistente,
    }
  })
}
