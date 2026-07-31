'use client'

import { useRef, useState } from 'react'
import { exportToExcel, importFromExcel } from '@/lib/admin/excel'

interface ExcelButtonsProps {
  exportFilename: string
  exportRows: () => Record<string, unknown>[]
  onImport: (rows: Record<string, string>[]) => Promise<string>
}

export function ExcelButtons({ exportFilename, exportRows, onImport }: ExcelButtonsProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [msg, setMsg] = useState('')

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImporting(true)
    setMsg('')
    try {
      const rows = await importFromExcel(file)
      const result = await onImport(rows)
      setMsg(result)
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Falha ao importar')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => exportToExcel(exportFilename, exportRows())}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
      >
        Exportar Excel
      </button>
      <button
        type="button"
        disabled={importing}
        onClick={() => fileRef.current?.click()}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-50"
      >
        {importing ? 'Importando…' : 'Importar Excel'}
      </button>
      <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} />
      {msg && <span className="text-xs text-slate-500">{msg}</span>}
    </div>
  )
}
