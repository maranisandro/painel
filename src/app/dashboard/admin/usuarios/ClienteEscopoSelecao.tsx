'use client'

import { useMemo, useState } from 'react'

/**
 * Multi-seleção de cliente por busca — pedido do usuário 2026-09-11: acesso
 * de usuário restrito a um ou mais clientes. Lista de clientes chega a
 * milhares (mesmo motivo do ClienteFiltro de venda, que é single-select);
 * aqui é busca por texto + chips do que já foi selecionado.
 */
export function ClienteEscopoSelecao({
  disponiveis,
  selecionados,
  onChange,
}: {
  disponiveis: string[]
  selecionados: string[]
  onChange: (clientes: string[]) => void
}) {
  const [query, setQuery] = useState('')

  const resultados = useMemo(() => {
    const q = query.trim().toLowerCase()
    const lista = disponiveis.filter((c) => !selecionados.includes(c) && (!q || c.toLowerCase().includes(q)))
    return lista.slice(0, 30)
  }, [query, disponiveis, selecionados])

  function adicionar(cliente: string) {
    onChange([...selecionados, cliente])
    setQuery('')
  }

  function remover(cliente: string) {
    onChange(selecionados.filter((c) => c !== cliente))
  }

  return (
    <div>
      {selecionados.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {selecionados.map((c) => (
            <span key={c} className="flex items-center gap-1 rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">
              {c}
              <button type="button" onClick={() => remover(c)} className="text-emerald-700 hover:text-emerald-950">
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar cliente para adicionar…"
        className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
      />
      {query && (
        <div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-sm">
          {resultados.length === 0 ? (
            <p className="px-3 py-2 text-xs text-slate-400">Nenhum cliente encontrado.</p>
          ) : (
            resultados.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => adicionar(c)}
                className="block w-full truncate px-3 py-1.5 text-left text-sm hover:bg-emerald-50"
              >
                {c}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
