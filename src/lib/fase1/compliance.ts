import { prisma } from '@/lib/prisma'

export interface CompositionLimits {
  cargaLiquidaMaxTon: number | null
}

/**
 * Carrega o teto de peso líquido (t) por composição (Cadastros → Composições
 * → tabela de referência). Composição sem cadastro fica sem limite (viagem
 * marcada como SEM_LIMITE, não como excesso).
 */
export async function buildComplianceMap(): Promise<Map<string, CompositionLimits>> {
  const specs = await prisma.compositionSpec.findMany({ where: { active: true } })
  const map = new Map<string, CompositionLimits>()
  for (const s of specs) {
    map.set(s.composition, {
      cargaLiquidaMaxTon: s.cargaLiquidaMaxTon ? Number(s.cargaLiquidaMaxTon) : null,
    })
  }
  return map
}

type Row = Record<string, unknown>

/**
 * Compara o peso líquido de cada viagem (PESOLIQUIDO em kg) com o teto de
 * carga líquida da composição vigente. Adiciona PESO_LIMITE_T, PESO_EXCESSO_T
 * (positivo = acima do limite) e STATUS_PESO (OK / EXCESSO / SEM_LIMITE).
 */
export function applyWeightCompliance(trips: Row[], specs: Map<string, CompositionLimits>): Row[] {
  return trips.map((trip) => {
    const spec = specs.get(String(trip['TipoComposição'] ?? ''))
    const pesoT = (Number(trip.PESOLIQUIDO) || 0) / 1000
    if (!spec || spec.cargaLiquidaMaxTon === null) {
      return { ...trip, PESO_LIMITE_T: null, PESO_EXCESSO_T: null, STATUS_PESO: 'SEM_LIMITE' }
    }
    const excesso = Math.round((pesoT - spec.cargaLiquidaMaxTon) * 100) / 100
    return {
      ...trip,
      PESO_LIMITE_T: spec.cargaLiquidaMaxTon,
      PESO_EXCESSO_T: excesso,
      STATUS_PESO: excesso > 0 ? 'EXCESSO' : 'OK',
    }
  })
}
