/**
 * Módulo Abastecimento — agregações de consumo/custo/volume sobre TODO o
 * universo de equipamentos da Officium (não só a frota de transporte da
 * Fase 1). Pedido do usuário 2026-08-27: "acompanhamento de custos e volume
 * total", separando diesel de gasolina.
 *
 * Custo: só ~37% dos lançamentos da Officium têm `val_unit` preenchido
 * (achado real, conferido direto na fonte em 2026-08-27) — não é bug do
 * painel, é lançamento que a origem não cadastrou (mesmo padrão já tratado
 * pro fator M3/MDC do Carvão: mostrar só o que existe, sinalizar quando
 * falta, nunca inventar/estimar em cima de dado ausente).
 */
import { categoriaProduto } from '@/lib/fase1/fuel'

export interface AbastecimentoRow {
  /** id do lançamento na Officium (supply_id) — chave estável pro detalhamento por equipamento */
  id: string
  equipamento: string
  tipoEquipamento: string
  date: string
  pedometer: number
  litros: number
  produto: string
  valorUnitario: number
}

export interface ResumoEquipamento {
  equipamento: string
  tipoEquipamento: string
  litrosTotal: number
  custoTotal: number
  /** true = pelo menos 1 lançamento com valor > 0 (custo abaixo é parcial, não o total real) */
  custoParcial: boolean
  nAbastecimentos: number
  ultimoAbastecimento: string | null
  diasSemAbastecer: number | null
  litrosPorCategoria: Record<string, number>
  /**
   * Pedômetro (km OU horas, conforme o equipamento — classificação por tipo
   * ainda não existe, ver nota no topo do dashboard) primeiro/último
   * registrado no histórico, e o avanço entre eles. Pedido do usuário
   * 2026-08-27: "informação estratégica volume de combustível VS total de
   * hodômetro ou horímetro" — negativo é sinal real de inconsistência (mesmo
   * caso já coberto pelo achado `hodometro_regrediu` na Crítica ao modelo),
   * não é escondido/corrigido aqui.
   */
  pedometerInicial: number | null
  pedometerFinal: number | null
  pedometerAvanco: number | null
  /** litros ÷ avanço de pedômetro — null quando o avanço não é positivo (sem base pra dividir) */
  litrosPorPedometro: number | null
}

export interface ResumoGeral {
  litrosTotal: number
  custoTotal: number
  custoConhecidoPct: number
  nEquipamentos: number
  litrosPorCategoria: { categoria: string; litros: number; custo: number; custoConhecidoPct: number }[]
}

/** Um resumo por equipamento — base da tabela principal do painel. */
export function resumirPorEquipamento(rows: AbastecimentoRow[]): ResumoEquipamento[] {
  const hoje = new Date().toISOString().slice(0, 10)
  const porEquipamento = new Map<string, AbastecimentoRow[]>()
  for (const r of rows) {
    if (!r.equipamento) continue
    const list = porEquipamento.get(r.equipamento) ?? []
    list.push(r)
    porEquipamento.set(r.equipamento, list)
  }

  const out: ResumoEquipamento[] = []
  for (const [equipamento, list] of porEquipamento.entries()) {
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date))
    const ultima = sorted[sorted.length - 1]
    const litrosPorCategoria: Record<string, number> = {}
    let litrosTotal = 0
    let custoTotal = 0
    let custoParcial = false
    for (const r of list) {
      const categoria = categoriaProduto(r.produto)
      litrosPorCategoria[categoria] = (litrosPorCategoria[categoria] ?? 0) + r.litros
      litrosTotal += r.litros
      if (r.valorUnitario > 0) {
        custoTotal += r.valorUnitario * r.litros
      } else {
        custoParcial = true
      }
    }
    const ultimoAbastecimento = ultima?.date.slice(0, 10) ?? null
    const diasSemAbastecer = ultimoAbastecimento
      ? Math.floor((Date.parse(hoje) - Date.parse(ultimoAbastecimento)) / 86_400_000)
      : null

    // Só considera leituras de pedômetro > 0 (registro sem contador
    // válido) pra achar a primeira/última — mesma ordenação cronológica já
    // usada acima, não por valor de pedômetro (que pode vir corrompido).
    const comPedometro = sorted.filter((r) => r.pedometer > 0)
    const pedometerInicial = comPedometro[0]?.pedometer ?? null
    const pedometerFinal = comPedometro[comPedometro.length - 1]?.pedometer ?? null
    const pedometerAvanco =
      pedometerInicial != null && pedometerFinal != null ? pedometerFinal - pedometerInicial : null
    const litrosPorPedometro = pedometerAvanco && pedometerAvanco > 0 ? litrosTotal / pedometerAvanco : null

    out.push({
      equipamento,
      tipoEquipamento: ultima?.tipoEquipamento || '—',
      litrosTotal,
      custoTotal,
      custoParcial,
      nAbastecimentos: list.length,
      ultimoAbastecimento,
      diasSemAbastecer,
      litrosPorCategoria,
      pedometerInicial,
      pedometerFinal,
      pedometerAvanco,
      litrosPorPedometro,
    })
  }
  return out.sort((a, b) => b.litrosTotal - a.litrosTotal)
}

/** KPIs consolidados do topo do painel + quebra por categoria de combustível. */
export function resumoGeral(rows: AbastecimentoRow[]): ResumoGeral {
  const porCategoria = new Map<string, { litros: number; custo: number; litrosComValor: number; custo0: number }>()
  let litrosTotal = 0
  let custoTotal = 0
  let litrosComValor = 0
  const equipamentos = new Set<string>()
  for (const r of rows) {
    if (r.equipamento) equipamentos.add(r.equipamento)
    const categoria = categoriaProduto(r.produto)
    const entry = porCategoria.get(categoria) ?? { litros: 0, custo: 0, litrosComValor: 0, custo0: 0 }
    entry.litros += r.litros
    litrosTotal += r.litros
    if (r.valorUnitario > 0) {
      const custo = r.valorUnitario * r.litros
      entry.custo += custo
      entry.litrosComValor += r.litros
      custoTotal += custo
      litrosComValor += r.litros
    }
    porCategoria.set(categoria, entry)
  }

  return {
    litrosTotal,
    custoTotal,
    custoConhecidoPct: litrosTotal > 0 ? (litrosComValor / litrosTotal) * 100 : 0,
    nEquipamentos: equipamentos.size,
    litrosPorCategoria: [...porCategoria.entries()]
      .map(([categoria, e]) => ({
        categoria,
        litros: e.litros,
        custo: e.custo,
        custoConhecidoPct: e.litros > 0 ? (e.litrosComValor / e.litros) * 100 : 0,
      }))
      .sort((a, b) => b.litros - a.litros),
  }
}
