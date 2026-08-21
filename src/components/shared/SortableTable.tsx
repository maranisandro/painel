'use client'

import { Fragment, useMemo, useState, type MouseEvent, type ReactNode } from 'react'

export interface SortableColumn<T> {
  key: string
  label: string
  align?: 'right' | 'center'
  /** valor usado para ordenar (number = numérico, string = alfabético) */
  sortValue: (row: T) => number | string
  /** valor usado para o filtro de texto por coluna — padrão usa sortValue como string */
  filterValue?: (row: T) => string
  render: (row: T) => ReactNode
}

/**
 * Tabela genérica com ordenação (clique no cabeçalho) e filtro de texto por
 * coluna (linha de inputs abaixo do cabeçalho) — pedido do usuário
 * 2026-08-04: "em todas as tabelas inserir opção de ordenação e filtros".
 * `renderExpanded`, quando informado, adiciona uma coluna de expandir/
 * recolher à esquerda (usada pelos drill-downs de cliente/produto).
 */
export function SortableTable<T>({
  columns,
  rows,
  rowKey,
  defaultSortKey,
  defaultSortDir = 'desc',
  renderExpanded,
  emptyMessage = 'Nenhum registro.',
  onRowClick,
  rowClassName,
  rowTitle,
  autoExpandKeys,
  renderFooter,
}: {
  columns: SortableColumn<T>[]
  rows: T[]
  rowKey: (row: T, index: number) => string
  defaultSortKey?: string
  defaultSortDir?: 'asc' | 'desc'
  renderExpanded?: (row: T) => ReactNode
  emptyMessage?: string
  /** linha inteira clicável (ex.: abrir modal de detalhe) — opcional, além do `render` de cada coluna */
  onRowClick?: (row: T, e: MouseEvent) => void
  /** classes extras por linha (ex.: destacar em vermelho quando há um alerta) */
  rowClassName?: (row: T) => string
  rowTitle?: (row: T) => string | undefined
  /**
   * Chaves (rowKey) já abertas quando a tabela monta — pedido do usuário
   * 2026-08-21: um clique em outra tela ("clicar e já abrir a nota
   * completa") precisa chegar aqui com a linha já expandida, sem exigir um
   * segundo clique manual no ▸. Só lido na primeira renderização (useState
   * lazy init) — a tabela é remontada (key muda ou o pai some/reaparece)
   * toda vez que o chamador quer forçar um novo auto-expand.
   */
  autoExpandKeys?: string[]
  /**
   * Linha de totais no rodapé — pedido do usuário 2026-08-21: "a tabela
   * precisa totalizar no final as colunas". Recebe as linhas JÁ filtradas
   * (pelos filtros de coluna) e ordenadas — o total reflete o que está
   * visível na tela, não a lista original completa.
   */
  renderFooter?: (rows: T[]) => ReactNode
}) {
  const [sortKey, setSortKey] = useState(defaultSortKey ?? columns[0]?.key)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(defaultSortDir)
  const [filtros, setFiltros] = useState<Record<string, string>>({})
  const [expandido, setExpandido] = useState<Set<string>>(() => new Set(autoExpandKeys ?? []))

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  function toggleExpand(key: string) {
    setExpandido((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const linhas = useMemo(() => {
    const filtradas = rows.filter((r) =>
      columns.every((c) => {
        const f = filtros[c.key]?.trim().toLowerCase()
        if (!f) return true
        const v = (c.filterValue ?? ((rr: T) => String(c.sortValue(rr)))) (r).toLowerCase()
        return v.includes(f)
      }),
    )
    const col = columns.find((c) => c.key === sortKey)
    if (!col) return filtradas
    return [...filtradas].sort((a, b) => {
      const av = col.sortValue(a)
      const bv = col.sortValue(b)
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv))
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [rows, columns, filtros, sortKey, sortDir])

  return (
    <table className="w-full text-sm">
      <thead className="bg-slate-50 text-left text-slate-600">
        <tr>
          {renderExpanded && <th className="w-8 px-3 py-2" />}
          {columns.map((c) => (
            <th
              key={c.key}
              onClick={() => toggleSort(c.key)}
              className={`cursor-pointer select-none whitespace-nowrap px-3 py-2 hover:bg-slate-100 ${c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : ''}`}
              title="Clique para ordenar"
            >
              {c.label} {sortKey === c.key && (sortDir === 'asc' ? '▲' : '▼')}
            </th>
          ))}
        </tr>
        <tr>
          {renderExpanded && <th className="px-3 py-1" />}
          {columns.map((c) => (
            <th key={c.key} className="px-3 py-1 font-normal">
              <input
                value={filtros[c.key] ?? ''}
                onChange={(e) => setFiltros((f) => ({ ...f, [c.key]: e.target.value }))}
                placeholder="filtrar…"
                className={`w-full rounded border border-slate-200 px-1.5 py-0.5 text-xs font-normal ${c.align === 'right' ? 'text-right' : ''}`}
              />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {linhas.map((r, i) => {
          const key = rowKey(r, i)
          const aberta = expandido.has(key)
          return (
            <Fragment key={key}>
              <tr
                className={`border-t border-slate-100 ${onRowClick ? 'cursor-pointer hover:bg-slate-50' : ''} ${rowClassName?.(r) ?? ''}`}
                onClick={onRowClick ? (e) => onRowClick(r, e) : undefined}
                title={rowTitle?.(r)}
              >
                {renderExpanded && (
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => toggleExpand(key)}
                      title={aberta ? 'Recolher' : 'Expandir'}
                      className="rounded px-1 text-slate-500 hover:bg-slate-100"
                    >
                      {aberta ? '▾' : '▸'}
                    </button>
                  </td>
                )}
                {columns.map((c) => (
                  <td key={c.key} className={`px-3 py-2 ${c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : ''}`}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
              {renderExpanded && aberta && (
                <tr className="border-t border-slate-100 bg-slate-50">
                  <td colSpan={columns.length + 1} className="px-3 py-2">
                    {renderExpanded(r)}
                  </td>
                </tr>
              )}
            </Fragment>
          )
        })}
        {linhas.length === 0 && (
          <tr>
            <td colSpan={columns.length + (renderExpanded ? 1 : 0)} className="px-4 py-8 text-center text-slate-500">
              {emptyMessage}
            </td>
          </tr>
        )}
      </tbody>
      {renderFooter && linhas.length > 0 && (
        <tfoot>
          <tr className="border-t-2 border-slate-300 bg-slate-50 font-medium">
            {renderExpanded && <td className="px-3 py-2" />}
            {renderFooter(linhas)}
          </tr>
        </tfoot>
      )}
    </table>
  )
}
