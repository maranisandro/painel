import { prisma } from '@/lib/prisma'

export interface MovimentoTransporteInterno {
  codColigada: number
  codFilial: number
  idMov: string
  numeroMov: string
  codtmv: string
  codigoPrd: string
  codLoc: string | null
  codCfo: string | null
}

export interface RegraTransporte {
  tipo: string
  prioridade: number
  codtmv: string | null
  produtos: string[] | null
  origemColigada: number | null
  origemFilial: number | null
  destinoColigada: number | null
  destinoFilial: number | null
}

/** Carrega as regras ativas, em ordem de prioridade (primeira que bater, vence). */
export async function carregarRegrasTransporte(): Promise<RegraTransporte[]> {
  const rows = await prisma.transportTypeRule.findMany({ where: { ativo: true }, orderBy: { prioridade: 'asc' } })
  return rows.map((r) => ({
    tipo: r.tipo,
    prioridade: r.prioridade,
    codtmv: r.codtmv,
    produtos: r.produtos ? r.produtos.split(',').map((v) => v.trim()).filter(Boolean) : null,
    origemColigada: r.origemColigada,
    origemFilial: r.origemFilial,
    destinoColigada: r.destinoColigada,
    destinoFilial: r.destinoFilial,
  }))
}

/**
 * Resolve coligada/filial de destino de uma movimentação interna — hoje só
 * via CODLOC no formato "<codColigada>.<codFilial>" (ex. "5.3"). PONTO DE
 * VALIDAÇÃO (spec, seção B.3): confirmar contra dado real se é este o
 * formato de CODLOC usado pelo TOTVS para essas movimentações, ou se o
 * destino vem de CODCFO (mapeado por um cadastro Location tipo UNIDADE) —
 * sem confirmação ainda, `codCfo` não é usado. Retorna `null` quando não dá
 * para resolver (a linha fica "não classificada").
 */
export function resolverDestino(linha: MovimentoTransporteInterno): { codColigada: number; codFilial: number } | null {
  if (!linha.codLoc) return null
  const partes = linha.codLoc.split('.')
  if (partes.length !== 2) return null
  const codColigada = Number(partes[0])
  const codFilial = Number(partes[1])
  if (!Number.isFinite(codColigada) || !Number.isFinite(codFilial)) return null
  return { codColigada, codFilial }
}

/**
 * Primeira regra (em ordem de prioridade) cujos campos preenchidos batem
 * TODOS com a linha, vence. Campo null na regra = "não filtra por isso".
 * Sem regra correspondente, retorna `null` (linha "não classificada").
 */
export function classificarTipoTransporte(linha: MovimentoTransporteInterno, regras: RegraTransporte[]): string | null {
  const destino = resolverDestino(linha)
  for (const regra of regras) {
    if (regra.codtmv && regra.codtmv !== linha.codtmv) continue
    if (regra.produtos && !regra.produtos.includes(linha.codigoPrd)) continue
    if (regra.origemColigada != null && regra.origemColigada !== linha.codColigada) continue
    if (regra.origemFilial != null && regra.origemFilial !== linha.codFilial) continue
    if (regra.destinoColigada != null && destino?.codColigada !== regra.destinoColigada) continue
    if (regra.destinoFilial != null && destino?.codFilial !== regra.destinoFilial) continue
    return regra.tipo
  }
  return null
}
