/**
 * Módulo Abastecimento — críticas ao modelo, reaproveitando os achados já
 * validados da Fase 1 (`src/lib/fase1/critica.ts`), só que sobre o universo
 * INTEIRO de equipamentos (não só a frota de transporte) e separando diesel
 * de gasolina (pedido do usuário 2026-08-27). As 3 funções reaproveitadas já
 * são genéricas o bastante (recebem `rows` + um `Set` de códigos
 * conhecidos) — só ganharam um parâmetro opcional `produtoMatch`/
 * `produtoLabel` (default = diesel, preserva 100% do comportamento da
 * Fase 1) pra permitir chamar de novo com o filtro de gasolina.
 */
import {
  achadosHodometroRegrediu,
  achadosHodometroTravado,
  achadosSemAbastecimentoProlongado,
  type AchadoDetectado,
} from '@/lib/fase1/critica'
import { DIESEL_MATCH, GASOLINA_MATCH } from '@/lib/fase1/fuel'

type Row = Record<string, unknown>

export function achadosAbastecimento(rows: Row[], equipamentosConhecidos: Set<string>): AchadoDetectado[] {
  return [
    ...achadosSemAbastecimentoProlongado(rows, equipamentosConhecidos, DIESEL_MATCH, 'diesel'),
    ...achadosSemAbastecimentoProlongado(rows, equipamentosConhecidos, GASOLINA_MATCH, 'gasolina'),
    ...achadosHodometroRegrediu(rows, equipamentosConhecidos, DIESEL_MATCH),
    ...achadosHodometroRegrediu(rows, equipamentosConhecidos, GASOLINA_MATCH),
    ...achadosHodometroTravado(rows, equipamentosConhecidos, DIESEL_MATCH, 'diesel'),
    ...achadosHodometroTravado(rows, equipamentosConhecidos, GASOLINA_MATCH, 'gasolina'),
  ]
}

export type { AchadoDetectado }
