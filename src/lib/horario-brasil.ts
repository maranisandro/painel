/**
 * Data/hora em `America/Sao_Paulo`, independente do fuso do processo Node
 * (o servidor de produção roda em UTC, `Date.getHours()`/`toISOString()` cru
 * dariam a hora errada). Usado para a regra de corte D-1/18h — pedido do
 * usuário 2026-08-13: "os comparativos do mês... até o D-1... chegou as
 * 18:00h do D já podemos incluir".
 */
// Instâncias reaproveitadas (não recriadas a cada chamada) — `diaBrasilDe`/
// `horaBrasilDe` rodam num loop por posição de GPS (até centenas de milhares
// de linhas, ver rota de pernoite) e `new Intl.DateTimeFormat(...)` a cada
// chamada é caro o bastante para virar um travamento real nesse volume
// (achado real 2026-08-17: mais de 2 minutos para ~355 mil posições).
const FMT_DIA_BRASIL = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' })
const FMT_HORA_BRASIL = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' })

export function hojeBrasil(): string {
  return FMT_DIA_BRASIL.format(new Date())
}

export function horaBrasil(): number {
  return Number(FMT_HORA_BRASIL.format(new Date()))
}

/** Mesmas `hojeBrasil()`/`horaBrasil()`, mas para um instante qualquer — usado para classificar posições de GPS por dia/hora local (pedido do usuário 2026-08-17: identificar onde os caminhões param à noite). */
export function diaBrasilDe(data: Date): string {
  return FMT_DIA_BRASIL.format(data)
}
export function horaBrasilDe(data: Date): number {
  return Number(FMT_HORA_BRASIL.format(data))
}

/**
 * Converte um instante em UTC ('YYYY-MM-DD HH:MM:SS', sem sufixo) para os
 * dígitos correspondentes em horário de Brasília. Usado para reconverter a
 * marca d'água de sincronização (extraída via `Date.toISOString()`, sempre
 * UTC) de volta ao horário local que o Oracle (RM.TMOV etc.) realmente grava
 * nas colunas `DATE` sem timezone — achado real 2026-08-13: comparar o
 * literal UTC direto contra a coluna local do Oracle deslocava o corte
 * incremental 3h para frente, perdendo silenciosamente notas fiscais
 * modificadas nesse intervalo a cada sincronização.
 */
export function utcParaBrasiliaDataHora(utcStr: string): string {
  const dt = new Date(`${utcStr.replace(' ', 'T')}Z`)
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(dt)
  const get = (tipo: string) => partes.find((p) => p.type === tipo)!.value
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`
}

/** 'YYYY-MM-DD' de ontem, sem depender de fuso (evita bug de subtrair 1 dia perto da virada UTC). */
export function diaAnteriorStr(dataStr: string): string {
  const [y, m, d] = dataStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() - 1)
  return dt.toISOString().slice(0, 10)
}

/**
 * Regra de corte D-1/18h: antes das 18h de hoje, o dado de hoje ainda pode
 * estar incompleto (venda/NF lançada ao longo do dia) — o comparativo
 * "oficial" (meta x realizado) usa só até ontem. Às 18h em diante, hoje já
 * pode entrar (não haverá mais lançamentos no dia). Não mexe no `to`
 * explicitamente escolhido pelo usuário para navegar períodos passados —
 * só entra quando o recorte pedido chega até hoje (ou depois).
 */
export function corteOficial(to: string): string {
  const hoje = hojeBrasil()
  if (to < hoje) return to
  return horaBrasil() >= 18 ? to : diaAnteriorStr(hoje)
}
