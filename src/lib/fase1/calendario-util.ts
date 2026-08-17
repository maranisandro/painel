/**
 * Calendário útil da frota (pedido do usuário 2026-08-17): segunda a sexta
 * conta 12 horas disponíveis por dia, sábado e domingo contam 4 horas —
 * base para o cálculo de Disponibilidade Mecânica e Eficiência Operacional.
 */

const HORAS_DIA_UTIL = 12
const HORAS_FIM_DE_SEMANA = 4

function ehFimDeSemana(dataStr: string): boolean {
  const [y, m, d] = dataStr.split('-').map(Number)
  const diaSemana = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0=domingo, 6=sábado
  return diaSemana === 0 || diaSemana === 6
}

export function horasDisponiveisDia(dataStr: string): number {
  return ehFimDeSemana(dataStr) ? HORAS_FIM_DE_SEMANA : HORAS_DIA_UTIL
}

function proximoDiaStr(dataStr: string): string {
  const [y, m, d] = dataStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + 1)
  return dt.toISOString().slice(0, 10)
}

/** Soma as horas do calendário útil entre `from` e `to`, inclusive dos dois extremos. */
export function horasCalendarioUtil(from: string, to: string): number {
  if (from > to) return 0
  let total = 0
  let d = from
  while (d <= to) {
    total += horasDisponiveisDia(d)
    d = proximoDiaStr(d)
  }
  return total
}

/**
 * Horas do calendário útil dentro da INTERSEÇÃO de [inicio,fim] (ex.: um
 * período de manutenção, com `fim` podendo ser hoje se ainda em aberto) com
 * [from,to] (o período filtrado no painel). Retorna 0 quando não há
 * sobreposição.
 */
export function horasCalendarioUtilNoIntervalo(inicio: string, fim: string, from: string, to: string): number {
  const inicioEfetivo = inicio > from ? inicio : from
  const fimEfetivo = fim < to ? fim : to
  return horasCalendarioUtil(inicioEfetivo, fimEfetivo)
}
