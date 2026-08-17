'use client'

interface CategoriaResumo {
  chave: string
  faturamentoLiquido: number
  m3Total: number
}

// Categoria padrão ao abrir o painel (pedido do usuário 2026-08-04: "trazer
// todas as categorias com um filtro superior por categoria, deixando o
// agronegócio como padrão marcado") — bate com o escopo da página de
// referência do Power BI antigo ("Meta Destino e Preço Médio por
// Distribuidor"), ligada à tabela de cotas do SharePoint que só cobre essa
// linha de produto. Compartilhada entre Fase3Dashboard e PainelEstrategico.
export const CATEGORIA_PADRAO = 'Agronegócio'

/**
 * Filtro de categoria (TipoProduto) em checkboxes — pedido do usuário
 * 2026-08-04: "trazer todas as categorias com um filtro superior por
 * categoria, deixando o agronegócio como padrão marcado". Compartilhado
 * entre a visão tática (Fase3Dashboard) e o painel estratégico anual
 * (PainelEstrategico) para manter o mesmo recorte de categoria nas duas.
 */
export function CategoriaFiltro({
  categoriasDisponiveis,
  porCategoria,
  selecionadas,
  onChange,
  titulo = 'Categorias de produto',
}: {
  categoriasDisponiveis: string[]
  porCategoria: CategoriaResumo[]
  selecionadas: string[]
  onChange: (categorias: string[]) => void
  /** Reaproveitado para outros filtros de checkbox no topo (ex. Marca AMARU/STANDARD) — pedido do usuário 2026-08-13 */
  titulo?: string
}) {
  if (categoriasDisponiveis.length === 0) return null

  function toggle(categoria: string) {
    if (selecionadas.includes(categoria)) onChange(selecionadas.filter((c) => c !== categoria))
    else onChange([...selecionadas, categoria])
  }

  const resumoPorCategoria = new Map(porCategoria.map((c) => [c.chave, c]))

  return (
    <div className="w-full rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-medium text-slate-600">{titulo}</p>
        <div className="flex gap-3 text-xs">
          <button type="button" className="text-emerald-700 hover:underline" onClick={() => onChange(categoriasDisponiveis)}>
            marcar todas
          </button>
          <button type="button" className="text-slate-500 hover:underline" onClick={() => onChange([])}>
            limpar
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {categoriasDisponiveis.map((categoria) => {
          const resumo = resumoPorCategoria.get(categoria)
          return (
            <label key={categoria} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={selecionadas.includes(categoria)}
                onChange={() => toggle(categoria)}
                className="h-4 w-4 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
              />
              {categoria}
              {resumo && (
                <span className="text-xs text-slate-400">
                  ({resumo.m3Total.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} m³)
                </span>
              )}
            </label>
          )
        })}
      </div>
    </div>
  )
}
