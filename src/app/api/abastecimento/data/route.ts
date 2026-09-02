import { NextResponse } from 'next/server'
import { getSessionUser, hasModuleAccess } from '@/lib/authz'
import { getDatasetView, getUltimaAtualizacao } from '@/lib/semantic/dataset-view'
import { resumirPorEquipamento, resumoGeral, type AbastecimentoRow } from '@/lib/abastecimento/resumo'

/**
 * Painel de Abastecimento — pedido do usuário 2026-08-27: reaproveitar a base
 * de abastecimento já sincronizada (Officium), mas pro universo INTEIRO de
 * equipamentos (742 hoje — caminhões, tratores, colhedeiras, geradores etc.),
 * não só a frota de transporte da Fase 1. Resumo/KPIs calculados aqui no
 * servidor (dataset com ~47 mil linhas — mais leve mandar já agregado do que
 * o bruto inteiro pro cliente).
 */
export async function GET() {
  const user = await getSessionUser()
  if (!hasModuleAccess(user, 'abastecimento')) return NextResponse.json({ error: 'acesso negado' }, { status: 403 })

  const fuelRows = await getDatasetView('fase1_abastecimento')
  const rows: AbastecimentoRow[] = fuelRows.map((r) => ({
    id: String(r.supply_id ?? ''),
    equipamento: String(r.PLACA ?? '').trim().toUpperCase(),
    tipoEquipamento: String(r.TIPO_EQUIPAMENTO ?? '').trim(),
    date: String(r.date ?? ''),
    pedometer: Number(r.pedometer) || 0,
    litros: Number(r.amount) || 0,
    produto: String(r.PRODUTO_ABASTECIMENTO ?? '').trim(),
    valorUnitario: Number(r.VALOR_UNITARIO) || 0,
  }))

  const ultimaAtualizacao = await getUltimaAtualizacao(['fase1_abastecimento'])

  return NextResponse.json({
    geral: resumoGeral(rows),
    porEquipamento: resumirPorEquipamento(rows),
    // Registros brutos — pedido do usuário 2026-08-27: "ter a opção de
    // detalhar os abastecimentos". Manda tudo de uma vez (mesmo padrão já
    // usado em /api/fase1/data com trips/abastecimento inteiros) em vez de
    // um endpoint por equipamento — evita 739 round-trips ao expandir linhas.
    registros: rows,
    ultimaAtualizacao,
  })
}
