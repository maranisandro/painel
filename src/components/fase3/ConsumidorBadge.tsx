'use client'

import { CATEGORIA_CONSUMIDOR_LABEL, type CategoriaConsumidor } from '@/lib/fase3/faturamento'

const ESTILO: Record<CategoriaConsumidor, string> = {
  revenda: 'bg-sky-100 text-sky-700',
  consumidor: 'bg-emerald-100 text-emerald-700',
  funcionario: 'bg-amber-100 text-amber-700',
  empreiteira: 'bg-purple-100 text-purple-700',
  outros: 'bg-slate-100 text-slate-600',
}

/**
 * Selo de classificação do cliente (RM.FCFOCOMPL.CONSUMIDOR normalizado) —
 * pedido do usuário 2026-09-22: ícone ao lado do nome do cliente nas telas
 * de venda de madeira tratada. `categoria=null` (sem classificação cadastrada
 * no ERP — maioria dos clientes) não renderiza nada, de propósito: mostrar
 * um selo "sem classificação" em 93% das linhas seria só ruído visual.
 */
export function ConsumidorBadge({ categoria }: { categoria: CategoriaConsumidor | null }) {
  if (!categoria) return null
  return (
    <span
      title={`Classificação do cliente (ERP): ${CATEGORIA_CONSUMIDOR_LABEL[categoria]}`}
      className={`ml-1.5 rounded px-1.5 py-0.5 text-[10px] font-medium ${ESTILO[categoria]}`}
    >
      {CATEGORIA_CONSUMIDOR_LABEL[categoria]}
    </span>
  )
}
