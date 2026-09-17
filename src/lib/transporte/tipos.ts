export type TipoTransporte =
  | 'venda_rodoviaria'
  | 'transferencia_interna'
  | 'talhao_carbonizacao'
  | 'tratamento'

/**
 * Tipos conhecidos pelo módulo Transporte unificado (pedido do usuário
 * 2026-09-15) — usado como sugestão na tela de cadastro de regras
 * (TransportTypeRule.tipo aceita qualquer string, mas estes 4 já cobrem os
 * fluxos identificados). Ver docs/superpowers/specs/2026-09-15-transporte-unificado-design.md.
 */
export const TIPOS_TRANSPORTE_CONHECIDOS: { code: TipoTransporte; label: string }[] = [
  { code: 'venda_rodoviaria', label: 'Venda rodoviária (carvão, cavaco, madeira tratada)' },
  { code: 'transferencia_interna', label: 'Transferência interna entre unidades' },
  { code: 'talhao_carbonizacao', label: 'Madeira para carvão (talhão → carbonização)' },
  { code: 'tratamento', label: 'Madeira para tratamento' },
]
