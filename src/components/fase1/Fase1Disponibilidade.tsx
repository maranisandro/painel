'use client'

import { useEffect, useMemo, useState } from 'react'
import { calcularDisponibilidadePlaca, type DisponibilidadePlaca } from '@/lib/fase1/disponibilidade'

const PRODUTOS_ESCOPO = new Set(['Carvão', 'Cavaco', 'Maravalha'])

function fmt(n: number, digits = 0): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: digits })
}
function fmtPct(n: number | null): string {
  return n === null ? '—' : `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`
}
function corPct(n: number | null): string {
  if (n === null) return 'text-slate-400'
  if (n >= 90) return 'text-emerald-700'
  if (n >= 70) return 'text-amber-600'
  return 'text-red-600'
}

interface ManutencaoInfo {
  placa: string
  startDate: string
  endDate: string | null
}

/**
 * Disponibilidade Mecânica e Eficiência Operacional (pedido do usuário
 * 2026-08-17) — sobre o mesmo período filtrado no painel principal (De/Até).
 * Calendário útil: seg-sex 12h/dia, fim de semana 4h/dia.
 *
 * O usuário pediu as 3 variantes de Eficiência Operacional lado a lado para
 * comparar e decidir qual usar: (1) horas rodando (GPS real) ÷ horas
 * disponíveis; (2) km real ÷ km esperado no ritmo, descontando manutenção;
 * (3) viagens concluídas ÷ viagens esperadas no tempo disponível.
 */
export function Fase1Disponibilidade({
  trips,
  manutencoes,
  from,
  to,
  metaKm,
  metaKmPorComposicao,
}: {
  trips: Record<string, unknown>[]
  manutencoes: ManutencaoInfo[]
  from: string
  to: string
  metaKm: number
  metaKmPorComposicao: Record<string, number>
}) {
  const [horasRodandoPorPlaca, setHorasRodandoPorPlaca] = useState<Map<string, number>>(new Map())
  const [carregandoGps, setCarregandoGps] = useState(false)

  useEffect(() => {
    let cancelado = false
    setCarregandoGps(true)
    fetch(`/api/fase1/disponibilidade/horas-rodando?from=${from}&to=${to}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: { placa: string; horasRodando: number }[]) => {
        if (cancelado) return
        setHorasRodandoPorPlaca(new Map(rows.map((r) => [r.placa, r.horasRodando])))
      })
      .finally(() => {
        if (!cancelado) setCarregandoGps(false)
      })
    return () => {
      cancelado = true
    }
  }, [from, to])

  const linhas = useMemo<DisponibilidadePlaca[]>(() => {
    const doPeriodo = trips.filter(
      (t) =>
        String(t['Consolida Transportadora'] ?? '') === 'Proprio' &&
        PRODUTOS_ESCOPO.has(String(t.TipoProduto ?? '')) &&
        String(t.DATASAIDA ?? '').slice(0, 10) >= from &&
        String(t.DATASAIDA ?? '').slice(0, 10) <= to,
    )

    const porPlaca = new Map<
      string,
      { kmReal: number; viagens: number; duracoes: number[]; composicoes: Map<string, number> }
    >()
    for (const t of doPeriodo) {
      const placa = String(t.PLACA ?? '').trim().toUpperCase()
      if (!placa) continue
      const entry = porPlaca.get(placa) ?? { kmReal: 0, viagens: 0, duracoes: [] as number[], composicoes: new Map<string, number>() }
      entry.kmReal += Number(t.KM_RODADO) || 0
      entry.viagens += 1
      const duracao = Number(t.DURACAO_HORAS)
      if (duracao > 0) entry.duracoes.push(duracao)
      const composicao = String(t['TipoComposição'] ?? '')
      if (composicao) entry.composicoes.set(composicao, (entry.composicoes.get(composicao) ?? 0) + 1)
      porPlaca.set(placa, entry)
    }

    // Fallback de frota: placas sem nenhuma viagem no período usam a duração
    // média de viagem de toda a frota (não têm como estimar viagens
    // esperadas a partir do próprio histórico vazio).
    const todasDuracoes = doPeriodo.map((t) => Number(t.DURACAO_HORAS)).filter((d) => d > 0)
    const duracaoMediaFrota = todasDuracoes.length ? todasDuracoes.reduce((s, d) => s + d, 0) / todasDuracoes.length : null

    const manutencoesPorPlaca = new Map<string, ManutencaoInfo[]>()
    for (const m of manutencoes) {
      const lista = manutencoesPorPlaca.get(m.placa) ?? []
      lista.push(m)
      manutencoesPorPlaca.set(m.placa, lista)
    }

    // Universo de placas: quem teve viagem no período OU manutenção no período.
    const placas = new Set([...porPlaca.keys(), ...manutencoesPorPlaca.keys()])

    return [...placas]
      .map((placa) => {
        const info = porPlaca.get(placa)
        const duracaoMediaViagemHoras = info?.duracoes.length
          ? info.duracoes.reduce((s, d) => s + d, 0) / info.duracoes.length
          : duracaoMediaFrota

        const composicaoMaisFrequente = info
          ? [...info.composicoes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
          : undefined
        const metaKmMensal = composicaoMaisFrequente ? (metaKmPorComposicao[composicaoMaisFrequente] ?? metaKm) : metaKm

        return calcularDisponibilidadePlaca({
          placa,
          from,
          to,
          manutencoes: manutencoesPorPlaca.get(placa) ?? [],
          horasRodando: horasRodandoPorPlaca.get(placa) ?? null,
          kmReal: info?.kmReal ?? 0,
          viagensReais: info?.viagens ?? 0,
          metaKmMensal,
          duracaoMediaViagemHoras,
        })
      })
      .sort((a, b) => a.placa.localeCompare(b.placa))
  }, [trips, manutencoes, from, to, metaKm, metaKmPorComposicao, horasRodandoPorPlaca])

  const media = (campo: keyof DisponibilidadePlaca): number | null => {
    const valores = linhas.map((l) => l[campo]).filter((v): v is number => typeof v === 'number')
    return valores.length ? valores.reduce((s, v) => s + v, 0) / valores.length : null
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
        Calendário útil: seg-sex 12h/dia, fim de semana 4h/dia. As 3 variantes de Eficiência Operacional abaixo são
        calculadas de formas diferentes — comparem para decidir qual reflete melhor a operação.
        {carregandoGps && ' Carregando dados de GPS (Eficiência 1)…'}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">Disponibilidade Mecânica (média)</p>
          <p className={`mt-1 text-2xl font-semibold ${corPct(media('disponibilidadeMecanicaPct'))}`}>
            {fmtPct(media('disponibilidadeMecanicaPct'))}
          </p>
          <p className="text-xs text-slate-500">(horas calendário − horas manutenção) ÷ horas calendário</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">Eficiência 1 — horas rodando</p>
          <p className={`mt-1 text-2xl font-semibold ${corPct(media('eficienciaHorasRodandoPct'))}`}>
            {fmtPct(media('eficienciaHorasRodandoPct'))}
          </p>
          <p className="text-xs text-slate-500">horas rodando (GPS) ÷ horas disponíveis</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">Eficiência 2 — km no ritmo</p>
          <p className={`mt-1 text-2xl font-semibold ${corPct(media('eficienciaKmRitmoPct'))}`}>
            {fmtPct(media('eficienciaKmRitmoPct'))}
          </p>
          <p className="text-xs text-slate-500">km real ÷ km esperado no ritmo (descontando manutenção)</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">Eficiência 3 — viagens</p>
          <p className={`mt-1 text-2xl font-semibold ${corPct(media('eficienciaViagensPct'))}`}>
            {fmtPct(media('eficienciaViagensPct'))}
          </p>
          <p className="text-xs text-slate-500">viagens concluídas ÷ viagens esperadas no tempo disponível</p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              <th className="px-3 py-2">Placa</th>
              <th className="px-3 py-2 text-right">Horas disponíveis</th>
              <th className="px-3 py-2 text-right">Disp. Mecânica</th>
              <th className="px-3 py-2 text-right">Horas rodando</th>
              <th className="px-3 py-2 text-right">Efic. 1</th>
              <th className="px-3 py-2 text-right">KM real</th>
              <th className="px-3 py-2 text-right">Efic. 2</th>
              <th className="px-3 py-2 text-right">Viagens</th>
              <th className="px-3 py-2 text-right">Efic. 3</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.placa} className="border-t border-slate-100">
                <td className="px-3 py-2 font-mono font-medium">{l.placa}</td>
                <td className="px-3 py-2 text-right">{fmt(l.horasDisponiveis)}</td>
                <td className={`px-3 py-2 text-right font-medium ${corPct(l.disponibilidadeMecanicaPct)}`}>
                  {fmtPct(l.disponibilidadeMecanicaPct)}
                </td>
                <td className="px-3 py-2 text-right">{l.horasRodando != null ? fmt(l.horasRodando, 1) : '—'}</td>
                <td className={`px-3 py-2 text-right font-medium ${corPct(l.eficienciaHorasRodandoPct)}`}>
                  {fmtPct(l.eficienciaHorasRodandoPct)}
                </td>
                <td className="px-3 py-2 text-right">{fmt(l.kmReal)}</td>
                <td className={`px-3 py-2 text-right font-medium ${corPct(l.eficienciaKmRitmoPct)}`}>
                  {fmtPct(l.eficienciaKmRitmoPct)}
                </td>
                <td className="px-3 py-2 text-right">{l.viagensReais}</td>
                <td className={`px-3 py-2 text-right font-medium ${corPct(l.eficienciaViagensPct)}`}>
                  {fmtPct(l.eficienciaViagensPct)}
                </td>
              </tr>
            ))}
            {linhas.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                  Nenhuma placa com viagem ou manutenção no período.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
