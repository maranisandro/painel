'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface SyncResult {
  datasetId: string
  name: string
  ok: boolean
  rowsUpserted?: number
  error?: string
}

interface Props {
  /** true quando outra sincronização (individual ou geral) já está rodando — pedido do usuário 2026-08-13 */
  disabled?: boolean
  onSyncStart?: () => void
  onSyncEnd?: () => void
}

export function SyncAllButton({ disabled, onSyncStart, onSyncEnd }: Props = {}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<SyncResult[] | null>(null)

  async function handleSync() {
    setLoading(true)
    setResults(null)
    onSyncStart?.()
    try {
      const res = await fetch('/api/datasets/sync-all', { method: 'POST' })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Falha na sincronização')
      setResults(body.results)
      router.refresh()
    } catch (err) {
      setResults([{ datasetId: '', name: 'Sincronização', ok: false, error: err instanceof Error ? err.message : String(err) }])
    } finally {
      setLoading(false)
      onSyncEnd?.()
    }
  }

  return (
    <div>
      <button
        onClick={handleSync}
        disabled={loading || disabled}
        className="rounded-md bg-emerald-700 px-4 py-1.5 text-sm text-white hover:bg-emerald-800 disabled:opacity-50"
      >
        {loading ? 'Sincronizando…' : 'Sincronizar tudo'}
      </button>
      {results && (
        <ul className="mt-2 space-y-1 text-xs">
          {results.map((r, i) => (
            <li key={r.datasetId || i} className={r.ok ? 'text-emerald-700' : 'text-red-600'}>
              {r.name}: {r.ok ? `${r.rowsUpserted ?? 0} linha(s)` : r.error}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
