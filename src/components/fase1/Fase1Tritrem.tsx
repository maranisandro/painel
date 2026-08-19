'use client'

import { useEffect, useMemo, useState } from 'react'
import { calcularConsumo, type ConsumoPlaca } from '@/lib/fase1/fuel'
import { SortableTable } from '@/components/shared/SortableTable'

interface PlacaTritrem {
  placa: string
  desde: string | null
}

interface SemComunicacaoInfo {
  placa: string
  situacao: 'SEM_RASTREADOR' | 'SEM_COMUNICACAO'
  ultimaPosicaoEm: string | null
  localizacao: string | null
  minutosSemComunicacao: number | null
}

interface LinhaTritrem {
  placa: string
  desde: string | null
  ultimaPosicaoEm: string | null
  localizacao: string | null
  minutosSemComunicacao: number | null
  temGps: boolean
  consumo: ConsumoPlaca | null
  viagensMadeira: number
  kmMadeira: number
  pesoMadeiraT: number
}

function fmt(n: number, digits = 0): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: digits })
}
function fmtDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}
function fmtDataHora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR')
}
function fmtDuracao(min: number): string {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`
}

/**
 * Acompanhamento das placas transferidas para Tritrem Florestal (transporte
 * de madeira, fora do escopo de negócio do Fase1) — pedido do usuário
 * 2026-08-19: "caso queira já criar uma aba para acompanharmos deslocamento
 * pelo rastreador, abastecimento podemos criar só não teremos as
 * informações de notas por enquanto. se aparecer nota de madeira pode
 * incluir" + "pode montar assim acompanhamos todas as placas".
 *
 * Sem dataset de vendas de madeira ainda (fase futura) — só GPS
 * (reaproveita a mesma lista de última posição/comunicação do Rastreamento)
 * e combustível (mesmo cálculo km/l já usado no resto do Fase1). Se alguma
 * nota de transporte aparecer pra essas placas no dataset atual, ela já é
 * sinalizada como crítica (achado "nota_apos_tritrem") — aqui só mostra o
 * resumo (viagens/km/peso), sem duplicar a lógica de crítica.
 */
export function Fase1Tritrem({
  placas,
  trips,
  abastecimento,
  metaConsumoKmL,
}: {
  placas: PlacaTritrem[]
  trips: Record<string, unknown>[]
  abastecimento: { PLACA: string; date: string; pedometer: number; amount: number; produto: string }[]
  metaConsumoKmL: number
}) {
  const [semComunicacao, setSemComunicacao] = useState<Map<string, SemComunicacaoInfo>>(new Map())
  const [carregando, setCarregando] = useState(false)

  useEffect(() => {
    let cancelado = false
    setCarregando(true)
    fetch('/api/fase1/rastreamento/sem-comunicacao?situacao=todas')
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: SemComunicacaoInfo[]) => {
        if (cancelado) return
        setSemComunicacao(new Map(rows.map((r) => [r.placa, r])))
      })
      .finally(() => {
        if (!cancelado) setCarregando(false)
      })
    return () => {
      cancelado = true
    }
  }, [])

  const linhas: LinhaTritrem[] = useMemo(() => {
    const placasSet = new Set(placas.map((p) => p.placa))
    // Sem período próprio nesta aba (o negócio de madeira ainda não tem
    // corte de mês/meta definido) — usa todo o histórico de combustível
    // disponível, igual ao "sem abastecimento prolongado" da Crítica.
    const hoje = new Date().toISOString().slice(0, 10)
    const consumoPorPlaca = new Map(
      calcularConsumo(abastecimento, placasSet, '2020-01-01', hoje, metaConsumoKmL).map((c) => [c.placa, c]),
    )
    const viagensPorPlaca = new Map<string, { n: number; km: number; pesoT: number }>()
    for (const t of trips) {
      const placa = String(t.PLACA ?? '').trim().toUpperCase()
      if (!placasSet.has(placa)) continue
      const info = viagensPorPlaca.get(placa) ?? { n: 0, km: 0, pesoT: 0 }
      info.n++
      info.km += Number(t.KM_RODADO) || 0
      info.pesoT += (Number(t.PESOLIQUIDO) || 0) / 1000
      viagensPorPlaca.set(placa, info)
    }

    return placas.map((p) => {
      const sc = semComunicacao.get(p.placa)
      const viagens = viagensPorPlaca.get(p.placa)
      return {
        placa: p.placa,
        desde: p.desde,
        ultimaPosicaoEm: sc?.ultimaPosicaoEm ?? null,
        localizacao: sc?.localizacao ?? null,
        minutosSemComunicacao: sc?.minutosSemComunicacao ?? null,
        temGps: !!sc && sc.situacao !== 'SEM_RASTREADOR',
        consumo: consumoPorPlaca.get(p.placa) ?? null,
        viagensMadeira: viagens?.n ?? 0,
        kmMadeira: viagens?.km ?? 0,
        pesoMadeiraT: viagens?.pesoT ?? 0,
      }
    })
  }, [placas, trips, abastecimento, metaConsumoKmL, semComunicacao])

  return (
    <div>
      <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
        <p className="text-sm text-amber-900">
          🪵 {placas.length} placa(s) transferida(s) para Tritrem Florestal (transporte de madeira) — fora das
          estatísticas do Transporte Rodoviário.
        </p>
        <p className="mt-1 text-xs text-amber-800">
          Sem dataset de vendas de madeira ainda (fase futura) — aqui só posição GPS e combustível. Se aparecer nota
          de transporte rodoviário pra alguma dessas placas, ela já é sinalizada em Crítica ao modelo.
        </p>
      </div>

      <SortableTable
        rows={linhas}
        rowKey={(l) => l.placa}
        defaultSortKey="placa"
        defaultSortDir="asc"
        emptyMessage={carregando ? 'carregando…' : 'Nenhuma placa em Tritrem Florestal.'}
        columns={[
          { key: 'placa', label: 'Placa', sortValue: (l) => l.placa, render: (l) => <span className="font-mono font-medium">{l.placa}</span> },
          {
            key: 'desde',
            label: 'Tritrem desde',
            sortValue: (l) => l.desde ?? '',
            render: (l) => (l.desde ? fmtDate(l.desde) : '—'),
          },
          {
            key: 'posicao',
            label: 'Última posição GPS',
            sortValue: (l) => l.ultimaPosicaoEm ?? '',
            render: (l) =>
              !l.temGps ? (
                <span className="text-slate-400">sem rastreador</span>
              ) : l.ultimaPosicaoEm ? (
                <span title={l.localizacao ?? ''}>
                  {fmtDataHora(l.ultimaPosicaoEm)}
                  {l.minutosSemComunicacao != null && l.minutosSemComunicacao > 120 && (
                    <span className="ml-1 text-red-700">(há {fmtDuracao(l.minutosSemComunicacao)})</span>
                  )}
                </span>
              ) : (
                '—'
              ),
          },
          {
            key: 'localizacao',
            label: 'Localização',
            sortValue: (l) => l.localizacao ?? '',
            render: (l) => <span className="text-xs text-slate-600">{l.localizacao ?? '—'}</span>,
          },
          {
            key: 'kml',
            label: 'Consumo (km/l)',
            align: 'right',
            sortValue: (l) => l.consumo?.kmPorLitro ?? -1,
            render: (l) => (l.consumo?.kmPorLitro != null ? fmt(l.consumo.kmPorLitro, 2) : '—'),
          },
          {
            key: 'viagens',
            label: 'Viagens (nota, se houver)',
            align: 'right',
            sortValue: (l) => l.viagensMadeira,
            render: (l) =>
              l.viagensMadeira > 0 ? (
                <span title="Nota apareceu no dataset de transporte rodoviário — ver Crítica ao modelo">
                  ⚠️ {l.viagensMadeira}
                </span>
              ) : (
                <span className="text-slate-400">0</span>
              ),
          },
          {
            key: 'km',
            label: 'KM (nota)',
            align: 'right',
            sortValue: (l) => l.kmMadeira,
            render: (l) => (l.kmMadeira > 0 ? fmt(l.kmMadeira) : '—'),
          },
        ]}
      />
    </div>
  )
}
