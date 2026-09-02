'use client'

import { useRef, useState } from 'react'
import { parseMatrizCotas } from '@/lib/admin/excel-matriz-cotas'

/**
 * Botão de importação da planilha-matriz de cotas (produto × mês e
 * distribuidor × mês) — pedido do usuário 2026-09-01: reimportável sempre
 * que a planilha-base for atualizada, sem precisar trocar o mês no topo da
 * tela (a planilha já traz o mês em cada coluna). Ver
 * `src/lib/admin/excel-matriz-cotas.ts` pro formato esperado.
 */
export function ImportarMatrizCotas({ onImported }: { onImported: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [msg, setMsg] = useState('')

  async function postLote(url: string, linhas: unknown[]): Promise<{ resumo: string; avisos: string[] }> {
    if (linhas.length === 0) return { resumo: '', avisos: [] }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ linhas }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      return { resumo: `falha ao importar (${body?.error ?? res.status})`, avisos: [] }
    }
    const r: { criados: number; atualizados: number; avisos?: string[] } = await res.json()
    return { resumo: `${r.criados} criado(s), ${r.atualizados} atualizado(s)`, avisos: r.avisos ?? [] }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImporting(true)
    setMsg('')
    try {
      const buffer = await file.arrayBuffer()
      const { produtos, distribuidores, avisos } = parseMatrizCotas(buffer)
      const partes: string[] = []
      const avisosApi: string[] = []
      if (produtos.length > 0) {
        const r = await postLote('/api/admin/product-quotas/import-matriz', produtos)
        partes.push(`Produtos: ${r.resumo}.`)
        avisosApi.push(...r.avisos)
      }
      if (distribuidores.length > 0) {
        const r = await postLote('/api/admin/distributor-quotas/import-matriz', distribuidores)
        partes.push(`Distribuidores: ${r.resumo}.`)
        avisosApi.push(...r.avisos)
      }
      if (partes.length === 0) partes.push('Nada para importar — confira se o arquivo tem as abas "plancotas" e/ou "MetaDistribuidor".')
      setMsg([...partes, ...avisos, ...avisosApi].join(' '))
      onImported()
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Falha ao ler o arquivo')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={importing}
        onClick={() => fileRef.current?.click()}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-50"
      >
        {importing ? 'Importando…' : 'Importar planilha de cotas (produto + distribuidor, todos os meses)'}
      </button>
      <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} />
      {msg && <span className="text-xs text-slate-500">{msg}</span>}
    </div>
  )
}
