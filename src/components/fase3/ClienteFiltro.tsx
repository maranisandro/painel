'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * Filtro por cliente em combo de pesquisa (pedido do usuário 2026-08-05: "no
 * painel mensal e estratégico colocar um filtro por cliente em um combo de
 * pesquisa") — lista de clientes chega a milhares, então checkbox/lista fixa
 * não funciona (padrão usado em CategoriaFiltro); aqui é busca por texto com
 * um resultado selecionável por vez. Compartilhado entre Fase3Dashboard
 * (tático) e PainelEstrategico (estratégico).
 */
export function ClienteFiltro({
  clientesDisponiveis,
  selecionado,
  onChange,
}: {
  clientesDisponiveis: string[]
  selecionado: string | null
  onChange: (cliente: string | null) => void
}) {
  const [query, setQuery] = useState('')
  const [aberto, setAberto] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickFora(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false)
    }
    document.addEventListener('mousedown', onClickFora)
    return () => document.removeEventListener('mousedown', onClickFora)
  }, [])

  const resultados = useMemo(() => {
    const q = query.trim().toLowerCase()
    const lista = q ? clientesDisponiveis.filter((c) => c.toLowerCase().includes(q)) : clientesDisponiveis
    return lista.slice(0, 50)
  }, [query, clientesDisponiveis])

  return (
    <div ref={ref} className="relative w-72">
      <label className="block text-xs font-medium text-slate-600">Cliente</label>
      <div className="mt-1 flex items-center gap-1">
        <input
          type="text"
          value={selecionado ?? query}
          onFocus={() => {
            setAberto(true)
            if (selecionado) setQuery('')
          }}
          onChange={(e) => {
            setQuery(e.target.value)
            setAberto(true)
            if (selecionado) onChange(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setAberto(false)
          }}
          placeholder="Buscar cliente…"
          className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
        {selecionado && (
          <button
            type="button"
            onClick={() => {
              onChange(null)
              setQuery('')
            }}
            title="Limpar filtro de cliente"
            className="rounded px-1.5 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          >
            ✕
          </button>
        )}
      </div>
      {aberto && !selecionado && (
        <div className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg">
          {resultados.length === 0 ? (
            <p className="px-3 py-2 text-xs text-slate-400">Nenhum cliente encontrado.</p>
          ) : (
            resultados.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  onChange(c)
                  setQuery('')
                  setAberto(false)
                }}
                className="block w-full truncate px-3 py-1.5 text-left text-sm hover:bg-emerald-50"
              >
                {c}
              </button>
            ))
          )}
          {clientesDisponiveis.length > resultados.length && (
            <p className="px-3 py-1 text-xs text-slate-400">
              mostrando {resultados.length} de {clientesDisponiveis.length} — refine a busca
            </p>
          )}
        </div>
      )}
    </div>
  )
}
