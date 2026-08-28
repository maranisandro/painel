'use client'

import { useEffect, useState } from 'react'

interface Achado {
  categoria: string
  chave: string
  titulo: string
  descricao: string
  status: 'aberto' | 'reconhecido' | 'encaminhado_origem' | 'resolvido'
  reconhecidoPor: string | null
  reconhecidoEm: string | null
  motivo: string | null
}

interface CriticaData {
  achados: Achado[]
  totalAberto: number
}

const STATUS_LABEL: Record<Achado['status'], string> = {
  aberto: 'Em aberto',
  reconhecido: 'Reconhecido',
  encaminhado_origem: 'Encaminhado para ajuste na origem',
  resolvido: 'Resolvido',
}
const STATUS_COR: Record<Achado['status'], string> = {
  aberto: 'bg-red-100 text-red-800',
  reconhecido: 'bg-amber-100 text-amber-800',
  encaminhado_origem: 'bg-sky-100 text-sky-800',
  resolvido: 'bg-emerald-100 text-emerald-800',
}

function fmtDataHora(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

/**
 * Abastecimento — Crítica ao modelo, mesmo padrão já usado na Fase 1/Fase 3
 * (`src/components/fase1/CriticaModeloTab.tsx`), só que sobre o dataset
 * inteiro de equipamentos (`/api/abastecimento/critica`, achados reusados de
 * `src/lib/fase1/critica.ts` via `src/lib/abastecimento/critica.ts`).
 */
export function CriticaModeloTab() {
  const [data, setData] = useState<CriticaData | null>(null)
  const [loading, setLoading] = useState(true)
  const [abrindoAcao, setAbrindoAcao] = useState<{ chave: string; status: 'reconhecido' | 'encaminhado_origem' } | null>(null)
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)

  function carregar() {
    setLoading(true)
    fetch('/api/abastecimento/critica')
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false))
  }

  useEffect(carregar, [])

  async function confirmarAcao(achado: Achado) {
    if (!abrindoAcao || !motivo.trim()) return
    setEnviando(true)
    try {
      await fetch('/api/abastecimento/critica', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chave: achado.chave,
          categoria: achado.categoria,
          descricao: achado.descricao,
          status: abrindoAcao.status,
          motivo: motivo.trim(),
        }),
      })
      setAbrindoAcao(null)
      setMotivo('')
      carregar()
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Achados recalculados ao vivo a partir de todo o histórico de abastecimento (frota inteira, não só transporte
        rodoviário) — não é uma lista fixa. Cada problema em aberto precisa de reconhecimento formal (fica registrado
        quem e por quê) ou ser encaminhado para ajuste na origem (Officium/telemetria), antes de sumir da lista de
        pendências.
      </p>

      {loading && <span className="text-xs text-slate-500">carregando…</span>}

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-xs text-slate-500">Achados em aberto</p>
        <p className={`text-lg font-semibold ${(data?.totalAberto ?? 0) > 0 ? 'text-red-600' : 'text-emerald-700'}`}>
          {data?.totalAberto ?? 0}
        </p>
      </div>

      <div className="space-y-3">
        {(data?.achados ?? []).map((a) => (
          <div key={`${a.categoria}|${a.chave}`} className={`rounded-xl border p-4 ${a.status === 'aberto' ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-white'}`}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-medium">{a.titulo}</h3>
              <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_COR[a.status]}`}>{STATUS_LABEL[a.status]}</span>
            </div>
            <p className="text-sm text-slate-700">{a.descricao}</p>

            {a.status !== 'aberto' && (
              <p className="mt-2 text-xs text-slate-500">
                {a.reconhecidoPor} em {fmtDataHora(a.reconhecidoEm)} — &ldquo;{a.motivo}&rdquo;
              </p>
            )}

            {a.status === 'aberto' && (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setAbrindoAcao({ chave: a.chave, status: 'reconhecido' })
                    setMotivo('')
                  }}
                  className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
                >
                  Reconhecer
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAbrindoAcao({ chave: a.chave, status: 'encaminhado_origem' })
                    setMotivo('')
                  }}
                  className="rounded-md border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-800 hover:bg-sky-100"
                >
                  Encaminhar para ajuste na origem
                </button>
              </div>
            )}

            {abrindoAcao?.chave === a.chave && (
              <div className="mt-3 space-y-2 rounded-lg border border-slate-200 bg-white p-3">
                <label className="text-xs font-medium text-slate-600">
                  {abrindoAcao.status === 'reconhecido' ? 'Motivo do reconhecimento' : 'O que precisa ser ajustado na origem'}
                </label>
                <textarea
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  rows={2}
                  className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  placeholder="ex.: confirmado com a oficina que o sensor de hodômetro está com defeito, já solicitada a troca"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={!motivo.trim() || enviando}
                    onClick={() => confirmarAcao(a)}
                    className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                  >
                    Confirmar
                  </button>
                  <button
                    type="button"
                    onClick={() => setAbrindoAcao(null)}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
        {(data?.achados.length ?? 0) === 0 && !loading && (
          <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
            Nenhum achado no histórico atual.
          </p>
        )}
      </div>
    </div>
  )
}
