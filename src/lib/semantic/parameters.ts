/**
 * Avaliador de parâmetros com fórmula.
 *
 * Um parâmetro pode ter valor fixo (valueNumber) ou fórmula (formula) que
 * referencia outros parâmetros pelo code e as variáveis de calendário:
 *   diasDoMes  — total de dias do mês corrente
 *   diaDoMes   — dia corrente do mês
 *
 * Exemplo (Fase 1): META_KM_MES = 8000
 *   RITMO_KM = META_KM_MES / diasDoMes * diaDoMes
 *
 * A fórmula aceita apenas números, identificadores, parênteses e + - * /.
 * Avaliação por parser próprio — nunca eval().
 */

export interface ParameterDef {
  code: string
  valueNumber?: number | null
  formula?: string | null
}

export interface CalendarVars {
  diasDoMes: number
  diaDoMes: number
}

export function calendarVarsFor(date: Date): CalendarVars {
  const diasDoMes = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  return { diasDoMes, diaDoMes: date.getDate() }
}

type Token = { kind: 'num'; value: number } | { kind: 'id'; name: string } | { kind: 'op'; op: string }

function tokenize(src: string): Token[] {
  const tokens: Token[] = []
  const re = /\s*(?:(\d+(?:[.,]\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|([()+\-*/]))/y
  let pos = 0
  while (pos < src.length) {
    re.lastIndex = pos
    const m = re.exec(src)
    if (!m) throw new Error(`Fórmula inválida próximo de: "${src.slice(pos, pos + 12)}"`)
    if (m[1]) tokens.push({ kind: 'num', value: Number(m[1].replace(',', '.')) })
    else if (m[2]) tokens.push({ kind: 'id', name: m[2] })
    else tokens.push({ kind: 'op', op: m[3] })
    pos = re.lastIndex
  }
  return tokens
}

class Parser {
  private i = 0
  constructor(
    private tokens: Token[],
    private resolve: (name: string) => number,
  ) {}

  parse(): number {
    const v = this.expr()
    if (this.i < this.tokens.length) throw new Error('Fórmula inválida: sobrou conteúdo após a expressão')
    return v
  }

  private peekOp(): string | null {
    const t = this.tokens[this.i]
    return t && t.kind === 'op' ? t.op : null
  }

  private expr(): number {
    let v = this.term()
    let op = this.peekOp()
    while (op === '+' || op === '-') {
      this.i++
      const rhs = this.term()
      v = op === '+' ? v + rhs : v - rhs
      op = this.peekOp()
    }
    return v
  }

  private term(): number {
    let v = this.factor()
    let op = this.peekOp()
    while (op === '*' || op === '/') {
      this.i++
      const rhs = this.factor()
      v = op === '*' ? v * rhs : v / rhs
      op = this.peekOp()
    }
    return v
  }

  private factor(): number {
    const t = this.tokens[this.i]
    if (!t) throw new Error('Fórmula incompleta')
    if (t.kind === 'num') {
      this.i++
      return t.value
    }
    if (t.kind === 'id') {
      this.i++
      return this.resolve(t.name)
    }
    if (t.op === '(') {
      this.i++
      const v = this.expr()
      if (this.peekOp() !== ')') throw new Error('Parêntese não fechado')
      this.i++
      return v
    }
    if (t.op === '-') {
      this.i++
      return -this.factor()
    }
    throw new Error(`Token inesperado na fórmula: ${JSON.stringify(t)}`)
  }
}

/**
 * Resolve o valor numérico de um parâmetro, seguindo fórmulas e referências
 * a outros parâmetros (com detecção de ciclo).
 */
export function resolveParameter(
  code: string,
  all: ParameterDef[],
  calendar: CalendarVars,
  visiting: Set<string> = new Set(),
): number {
  if (code === 'diasDoMes') return calendar.diasDoMes
  if (code === 'diaDoMes') return calendar.diaDoMes

  const def = all.find((p) => p.code === code)
  if (!def) throw new Error(`Parâmetro não encontrado: ${code}`)
  if (visiting.has(code)) throw new Error(`Referência circular em parâmetros: ${code}`)

  if (def.formula) {
    visiting.add(code)
    const tokens = tokenize(def.formula)
    const value = new Parser(tokens, (name) => resolveParameter(name, all, calendar, visiting)).parse()
    visiting.delete(code)
    return value
  }
  if (def.valueNumber !== null && def.valueNumber !== undefined) return Number(def.valueNumber)
  throw new Error(`Parâmetro sem valor nem fórmula: ${code}`)
}
/**
 * Valida uma definição candidata antes de persistir. O candidato substitui
 * temporariamente o parâmetro de mesmo código no conjunto atual, permitindo
 * detectar sintaxe inválida, referências ausentes, ciclos e divisões por zero
 * sem deixar uma configuração quebrada no banco.
 */
export function validateParameterDefinition(
  candidate: ParameterDef,
  all: ParameterDef[],
  calendar: CalendarVars = calendarVarsFor(new Date()),
): void {
  if (!candidate.formula) return
  const definitions = [...all.filter((parameter) => parameter.code !== candidate.code), candidate]
  const value = resolveParameter(candidate.code, definitions, calendar)
  if (!Number.isFinite(value)) {
    throw new Error('O resultado da fórmula deve ser um número finito')
  }
}
