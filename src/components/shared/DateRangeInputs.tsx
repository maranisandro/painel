'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// Máscara dd/mm/aaaa para filtros de período (padrão do painel) — o input
// nativo type="date" segue o locale do navegador/SO, que nem sempre é pt-BR
// (ex.: exibe mm/dd/aaaa e nomes de mês em inglês mesmo com <html lang="pt-BR">).
export function formatBRInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8)
  const parts = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean)
  return parts.join('/')
}

export function parseBRToIso(br: string): string | null {
  const m = br.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return null
  const [, d, mo, y] = m
  return `${y}-${mo}-${d}`
}

/** 'YYYY-MM-DD' -> 'DD/MM/AAAA' */
export function fmtDateBR(iso: string): string {
  const [ano, mes, dia] = iso.slice(0, 10).split('-')
  if (!ano || !mes || !dia) return iso
  return `${dia}/${mes}/${ano}`
}

const DIAS_SEMANA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']

// Calendário pequeno em popover — alternativa a digitar, sem usar o input
// nativo type="date" (ver formatBRInput acima). Clique num dia seleciona e fecha.
export function MiniCalendarButton({
  valueIso,
  onSelect,
}: {
  valueIso: string
  onSelect: (iso: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const [view, setView] = useState(() => {
    const d = valueIso ? new Date(`${valueIso}T00:00:00`) : new Date()
    return { y: d.getFullYear(), m: d.getMonth() }
  })
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  // Largura do popover (w-64 = 16rem) — usada só pra decidir o lado que cabe na tela.
  const POPOVER_WIDTH = 256

  useEffect(() => {
    if (!open) return
    function onClickOutside(e: MouseEvent) {
      const target = e.target as Node
      if (buttonRef.current?.contains(target)) return
      if (popoverRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  function abrir() {
    const d = valueIso ? new Date(`${valueIso}T00:00:00`) : new Date()
    setView({ y: d.getFullYear(), m: d.getMonth() })
    // Bug real (pedido do usuário 2026-08-29): o popover era `position:
    // absolute` dentro do próprio filtro, então ficava cortado pelo
    // `overflow-x-hidden`/scrollbar do <main> do dashboard sempre que o
    // botão "Até" (perto da borda direita da barra de filtros) tentava abrir
    // pra fora da área visível — nenhum ajuste de alinhamento esquerda/
    // direita resolve isso, porque o corte é do container pai, não da
    // posição. Corrigido renderizando o calendário num portal direto no
    // `document.body`, com `position: fixed` calculada a partir da posição
    // real do botão na tela — escapa de qualquer `overflow` de ancestral.
    const rect = buttonRef.current?.getBoundingClientRect()
    if (rect) {
      const left = rect.right + POPOVER_WIDTH > window.innerWidth ? rect.right - POPOVER_WIDTH : rect.left
      setPos({ top: rect.bottom + 4, left })
    }
    setOpen(true)
  }

  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate()
  const firstWeekday = new Date(view.y, view.m, 1).getDay()
  const monthLabel = new Date(view.y, view.m, 1).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
  })

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (open ? setOpen(false) : abrir())}
        title="Escolher data no calendário"
        className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm hover:bg-slate-100"
      >
        📅
      </button>
      {open &&
        pos &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={popoverRef}
            style={{ top: pos.top, left: pos.left }}
            className="fixed z-50 w-64 rounded-md border border-slate-200 bg-white p-2 shadow-lg"
          >
            <div className="flex items-center justify-between px-1 pb-1">
              <button
                type="button"
                onClick={() => setView((v) => (v.m === 0 ? { y: v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 }))}
                className="rounded px-2 py-0.5 text-slate-600 hover:bg-slate-100"
              >
                ‹
              </button>
              <span className="text-sm font-medium capitalize">{monthLabel}</span>
              <button
                type="button"
                onClick={() => setView((v) => (v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 }))}
                className="rounded px-2 py-0.5 text-slate-600 hover:bg-slate-100"
              >
                ›
              </button>
            </div>
            <div className="grid grid-cols-7 gap-0.5 text-center text-[11px] text-slate-400">
              {DIAS_SEMANA.map((d, i) => (
                <span key={i}>{d}</span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-0.5">
              {Array.from({ length: firstWeekday }).map((_, i) => (
                <span key={`vazio-${i}`} />
              ))}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1
                const iso = `${view.y}-${String(view.m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                const isSelected = iso === valueIso
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => {
                      onSelect(iso)
                      setOpen(false)
                    }}
                    className={`rounded py-1 text-xs hover:bg-emerald-100 ${isSelected ? 'bg-emerald-700 text-white hover:bg-emerald-700' : 'text-slate-700'}`}
                  >
                    {day}
                  </button>
                )
              })}
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}

/**
 * Um único campo de data com máscara dd/mm/aaaa + calendário — mesma ideia
 * de `DateRangeInputs`, só que pra telas com uma data só (ex.: Relatório
 * D-1), em vez do par De/Até. Pedido do usuário 2026-08-24: o Relatório D-1
 * usava `<input type="date">` nativo, que segue o locale do navegador/SO em
 * vez do padrão dd/mm/aaaa do resto do painel Fase3 — mesmo motivo já
 * documentado acima para o De/Até.
 */
export function SingleDateInput({
  label,
  valueIso,
  onChange,
}: {
  label: string
  valueIso: string
  onChange: (iso: string) => void
}) {
  const [text, setText] = useState(fmtDateBR(valueIso))

  useEffect(() => setText(fmtDateBR(valueIso)), [valueIso])

  return (
    <div className="flex items-end gap-1">
      <div>
        <label className="block text-xs font-medium text-slate-600">{label}</label>
        <input
          type="text"
          inputMode="numeric"
          value={text}
          onChange={(e) => {
            const formatted = formatBRInput(e.target.value)
            setText(formatted)
            const iso = parseBRToIso(formatted)
            if (iso) onChange(iso)
          }}
          placeholder="dd/mm/aaaa"
          maxLength={10}
          className="mt-1 w-28 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
      </div>
      <MiniCalendarButton
        valueIso={valueIso}
        onSelect={(iso) => {
          onChange(iso)
          setText(fmtDateBR(iso))
        }}
      />
    </div>
  )
}

/** Par De/Até com máscara dd/mm/aaaa + calendário — ver MiniCalendarButton acima. */
export function DateRangeInputs({
  from,
  to,
  onFromChange,
  onToChange,
}: {
  from: string
  to: string
  onFromChange: (iso: string) => void
  onToChange: (iso: string) => void
}) {
  const [fromText, setFromText] = useState(fmtDateBR(from))
  const [toText, setToText] = useState(fmtDateBR(to))

  useEffect(() => setFromText(fmtDateBR(from)), [from])
  useEffect(() => setToText(fmtDateBR(to)), [to])

  return (
    <>
      <div>
        <label className="block text-xs font-medium text-slate-600">De</label>
        <input
          type="text"
          inputMode="numeric"
          value={fromText}
          onChange={(e) => {
            const formatted = formatBRInput(e.target.value)
            setFromText(formatted)
            const iso = parseBRToIso(formatted)
            if (iso) onFromChange(iso)
          }}
          placeholder="dd/mm/aaaa"
          maxLength={10}
          className="mt-1 w-28 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
      </div>
      <MiniCalendarButton
        valueIso={from}
        onSelect={(iso) => {
          onFromChange(iso)
          setFromText(fmtDateBR(iso))
        }}
      />
      <div>
        <label className="block text-xs font-medium text-slate-600">Até</label>
        <input
          type="text"
          inputMode="numeric"
          value={toText}
          onChange={(e) => {
            const formatted = formatBRInput(e.target.value)
            setToText(formatted)
            const iso = parseBRToIso(formatted)
            if (iso) onToChange(iso)
          }}
          placeholder="dd/mm/aaaa"
          maxLength={10}
          className="mt-1 w-28 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
      </div>
      <MiniCalendarButton
        valueIso={to}
        onSelect={(iso) => {
          onToChange(iso)
          setToText(fmtDateBR(iso))
        }}
      />
    </>
  )
}
