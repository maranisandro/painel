/**
 * Avaliador de colunas condicionais — o equivalente configurável das etapas
 * "Coluna Condicional Adicionada" do PowerQuery. Os valores originais da
 * linha (data) nunca são alterados; o resultado é uma coluna adicional.
 *
 * Formato das regras (ComputedColumn.rules, type = CONDITIONAL):
 * {
 *   "rules": [
 *     { "when": [{ "field": "Produto", "op": "contains", "value": "CARVAO" }], "then": "Carvão" },
 *     { "when": [{ "field": "PLACA", "op": "in", "value": ["SES5B24","SES5B32"] }], "then": "Rodo Caçamba" }
 *   ],
 *   "else": "Outros"
 * }
 * Condições dentro de "when" são combinadas com E (AND). Regras avaliadas em ordem.
 */

export type ConditionOp = 'contains' | 'equals' | 'in' | 'gte' | 'lte' | 'gt' | 'lt' | 'startsWith'

export interface Condition {
  field: string
  op: ConditionOp
  value: unknown
}

export interface ConditionalRule {
  when: Condition[]
  then: unknown
}

export interface ConditionalRules {
  rules: ConditionalRule[]
  else?: unknown
}

type Row = Record<string, unknown>

function normalize(v: unknown): string {
  return String(v ?? '').toUpperCase().trim()
}

function evalCondition(row: Row, c: Condition): boolean {
  const raw = row[c.field]
  switch (c.op) {
    case 'contains':
      return normalize(raw).includes(normalize(c.value))
    case 'startsWith':
      return normalize(raw).startsWith(normalize(c.value))
    case 'equals':
      if (typeof raw === 'number' && typeof c.value !== 'object') return raw === Number(c.value)
      return normalize(raw) === normalize(c.value)
    case 'in': {
      const list = Array.isArray(c.value) ? c.value : []
      return list.some((v) => normalize(v) === normalize(raw))
    }
    case 'gte':
      return Number(raw) >= Number(c.value)
    case 'lte':
      return Number(raw) <= Number(c.value)
    case 'gt':
      return Number(raw) > Number(c.value)
    case 'lt':
      return Number(raw) < Number(c.value)
    default:
      return false
  }
}

export function evaluateConditional(row: Row, rules: ConditionalRules): unknown {
  for (const rule of rules.rules ?? []) {
    if (rule.when.every((c) => evalCondition(row, c))) return rule.then
  }
  return rules.else ?? null
}

/** Aplica uma lista de colunas condicionais a uma linha, em ordem de posição.
 *  Colunas já calculadas ficam visíveis para as seguintes (como no PowerQuery). */
export function applyComputedColumns(
  row: Row,
  columns: { name: string; rules: ConditionalRules }[],
): Row {
  const out: Row = { ...row }
  for (const col of columns) {
    out[col.name] = evaluateConditional(out, col.rules)
  }
  return out
}
