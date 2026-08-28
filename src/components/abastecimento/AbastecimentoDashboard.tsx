'use client'

import { useEffect, useMemo, useState } from 'react'
import { SortableTable } from '@/components/shared/SortableTable'
import { CriticaModeloTab } from './CriticaModeloTab'

interface ResumoEquipamento {
  equipamento: string
  tipoEquipamento: string
  litrosTotal: number
  custoTotal: number
  custoParcial: boolean
  nAbastecimentos: number
  ultimoAbastecimento: string | null
  diasSemAbastecer: number | null
  litrosPorCategoria: Record<string, number>
  pedometerInicial: number | null
  pedometerFinal: number | null
  pedometerAvanco: number | null
  litrosPorPedometro: number | null
}

interface ResumoGeral {
  litrosTotal: number
  custoTotal: number
  custoConhecidoPct: number
  nEquipamentos: number
  litrosPorCategoria: { categoria: string; litros: number; custo: number; custoConhecidoPct: number }[]
}

interface RegistroBruto {
  id: string
  equipamento: string
  tipoEquipamento: string
  date: string
  pedometer: number
  litros: number
  produto: string
  valorUnitario: number
}

interface AbastecimentoData {
  geral: ResumoGeral
  porEquipamento: ResumoEquipamento[]
  registros: RegistroBruto[]
}

type Aba = 'resumo' | 'critica'

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

/**
 * Módulo Abastecimento (Fase 7, transversal) — pedido do usuário 2026-08-27:
 * reaproveitar a base de abastecimento (Officium) já sincronizada, mas pro
 * universo INTEIRO de equipamentos (não só a frota de transporte da Fase 1),
 * com análises de consumo, dias sem abastecer, hodômetro/horímetro negativo,
 * diesel × gasolina separados, e acompanhamento de custo/volume.
 *
 * V1 — a classificação hodômetro (km) × horímetro (h) por tipo de
 * equipamento fica para depois (pedido explícito do usuário: "depois vamos
 * ver como separar as categorias de KM/L e L/HR") — por isso a tabela usa
 * "pedômetro" genérico (contador do equipamento, seja km ou horas) sem
 * calcular nenhuma taxa de consumo por unidade ainda.
 */
export function AbastecimentoDashboard() {
  const [aba, setAba] = useState<Aba>('resumo')
  const [data, setData] = useState<AbastecimentoData | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')

  useEffect(() => {
    let cancelado = false
    setLoading(true)
    fetch('/api/abastecimento/data')
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error ?? 'Falha ao carregar dados')
        return r.json()
      })
      .then((d: AbastecimentoData) => {
        if (cancelado) return
        setData(d)
        setErro('')
      })
      .catch((e) => {
        if (!cancelado) setErro(e instanceof Error ? e.message : 'Falha ao carregar dados')
      })
      .finally(() => {
        if (!cancelado) setLoading(false)
      })
    return () => {
      cancelado = true
    }
  }, [])

  const geral = data?.geral

  // Detalhamento por equipamento (pedido do usuário 2026-08-27: "ter a
  // opção de detalhar os abastecimentos") — agrupa os registros brutos já
  // trazidos pela API, mais recente primeiro.
  const registrosPorEquipamento = useMemo(() => {
    const map = new Map<string, RegistroBruto[]>()
    for (const r of data?.registros ?? []) {
      const list = map.get(r.equipamento) ?? []
      list.push(r)
      map.set(r.equipamento, list)
    }
    for (const list of map.values()) list.sort((a, b) => b.date.localeCompare(a.date))
    return map
  }, [data])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Abastecimento</h1>
        <p className="text-sm text-slate-500">
          Consumo, custo e volume de todos os equipamentos que abastecem pela Officium — não só a frota de transporte
          (742 equipamentos hoje: caminhões, tratores, colhedeiras, geradores etc.).
        </p>
      </div>

      {erro && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
      {loading && <span className="text-xs text-slate-500">carregando…</span>}

      <div className="flex gap-2">
        {(['resumo', 'critica'] as Aba[]).map((a) => (
          <button
            key={a}
            onClick={() => setAba(a)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              aba === a ? 'bg-emerald-700 text-white' : 'border border-slate-300 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {a === 'resumo' ? 'Resumo' : 'Crítica ao modelo'}
          </button>
        ))}
      </div>

      {aba === 'critica' ? (
        <CriticaModeloTab />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-sm text-slate-500">Volume total</p>
              <p className="mt-1 text-2xl font-semibold text-slate-700">{fmt(geral?.litrosTotal ?? 0)} L</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-sm text-slate-500">Custo total</p>
              <p className="mt-1 text-2xl font-semibold text-slate-700">
                R$ {fmt(geral?.custoTotal ?? 0, 2)}
              </p>
              <p className="text-[11px] text-slate-400">
                conhecido em {fmt(geral?.custoConhecidoPct ?? 0, 1)}% do volume — a Officium não lança valor em todo
                abastecimento
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-sm text-slate-500">Equipamentos com abastecimento</p>
              <p className="mt-1 text-2xl font-semibold text-slate-700">{geral?.nEquipamentos ?? 0}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-sm text-slate-500">Período</p>
              <p className="mt-1 text-sm text-slate-700">desde 01/01/2026 (início da base sincronizada)</p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-4 py-3">
              <span className="font-medium">Por categoria de combustível</span>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2">Categoria</th>
                  <th className="px-3 py-2 text-right">Litros</th>
                  <th className="px-3 py-2 text-right">Custo</th>
                  <th className="px-3 py-2 text-right">Custo conhecido</th>
                </tr>
              </thead>
              <tbody>
                {(geral?.litrosPorCategoria ?? []).map((c) => (
                  <tr key={c.categoria} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium">{c.categoria}</td>
                    <td className="px-3 py-2 text-right">{fmt(c.litros)} L</td>
                    <td className="px-3 py-2 text-right">R$ {fmt(c.custo, 2)}</td>
                    <td className="px-3 py-2 text-right text-xs text-slate-500">{fmt(c.custoConhecidoPct, 1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-slate-500">
            Clique na seta pra ver o detalhamento de cada abastecimento do equipamento.
          </p>
          <SortableTable
            rows={data?.porEquipamento ?? []}
            rowKey={(r) => r.equipamento}
            defaultSortKey="dias"
            defaultSortDir="desc"
            emptyMessage={loading ? 'carregando…' : 'Nenhum abastecimento encontrado.'}
            renderExpanded={(r) => {
              const registros = registrosPorEquipamento.get(r.equipamento) ?? []
              return (
                <div className="overflow-x-auto p-2">
                  <table className="w-full text-xs">
                    <thead className="text-left text-slate-500">
                      <tr>
                        <th className="px-2 py-1">Data/hora</th>
                        <th className="px-2 py-1">Produto</th>
                        <th className="px-2 py-1 text-right">Litros</th>
                        <th className="px-2 py-1 text-right">Pedômetro</th>
                        <th className="px-2 py-1 text-right">Valor/L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {registros.map((reg) => (
                        <tr key={reg.id} className="border-t border-slate-100">
                          <td className="px-2 py-1 whitespace-nowrap">{fmtDataHora(reg.date)}</td>
                          <td className="px-2 py-1">{reg.produto || '—'}</td>
                          <td className="px-2 py-1 text-right">{fmt(reg.litros, 2)}</td>
                          <td className="px-2 py-1 text-right">{reg.pedometer > 0 ? fmt(reg.pedometer) : '—'}</td>
                          <td className="px-2 py-1 text-right">{reg.valorUnitario > 0 ? `R$ ${fmt(reg.valorUnitario, 3)}` : '—'}</td>
                        </tr>
                      ))}
                      {registros.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-2 py-2 text-center text-slate-400">
                            Nenhum registro.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )
            }}
            columns={[
              {
                key: 'equipamento',
                label: 'Equipamento',
                sortValue: (r) => r.equipamento,
                render: (r) => <span className="font-mono font-medium">{r.equipamento}</span>,
              },
              { key: 'tipo', label: 'Tipo (Officium)', sortValue: (r) => r.tipoEquipamento, render: (r) => r.tipoEquipamento || '—' },
              {
                key: 'diesel',
                label: 'Diesel (L)',
                align: 'right',
                sortValue: (r) => r.litrosPorCategoria.DIESEL ?? 0,
                render: (r) => (r.litrosPorCategoria.DIESEL ? fmt(r.litrosPorCategoria.DIESEL) : '—'),
              },
              {
                key: 'gasolina',
                label: 'Gasolina (L)',
                align: 'right',
                sortValue: (r) => r.litrosPorCategoria.GASOLINA ?? 0,
                render: (r) => (r.litrosPorCategoria.GASOLINA ? fmt(r.litrosPorCategoria.GASOLINA) : '—'),
              },
              {
                key: 'litrosTotal',
                label: 'Volume total (L)',
                align: 'right',
                sortValue: (r) => r.litrosTotal,
                render: (r) => fmt(r.litrosTotal),
              },
              {
                key: 'pedometro',
                label: 'Pedômetro (1º → último)',
                align: 'right',
                sortValue: (r) => r.pedometerAvanco ?? -Infinity,
                render: (r) =>
                  r.pedometerInicial != null && r.pedometerFinal != null ? (
                    <span
                      className={r.pedometerAvanco != null && r.pedometerAvanco < 0 ? 'font-medium text-red-700' : ''}
                      title="Hodômetro (km) ou horímetro (h), conforme o equipamento — classificação por tipo ainda não existe (ver nota no topo da página). Negativo = mesma inconsistência já sinalizada na Crítica ao modelo."
                    >
                      {fmt(r.pedometerInicial)} → {fmt(r.pedometerFinal)}
                    </span>
                  ) : (
                    '—'
                  ),
              },
              {
                key: 'litrosPorPedometro',
                label: 'Volume ÷ pedômetro',
                align: 'right',
                sortValue: (r) => r.litrosPorPedometro ?? -1,
                render: (r) =>
                  r.litrosPorPedometro != null ? (
                    <span title="L por km OU por hora, conforme o tipo do equipamento — ainda sem classificação automática">
                      {fmt(r.litrosPorPedometro, 3)}
                    </span>
                  ) : (
                    '—'
                  ),
              },
              {
                key: 'custo',
                label: 'Custo',
                align: 'right',
                sortValue: (r) => r.custoTotal,
                render: (r) => (
                  <span title={r.custoParcial ? 'Custo parcial — nem todo abastecimento tem valor lançado na origem' : undefined}>
                    R$ {fmt(r.custoTotal, 2)}
                    {r.custoParcial && <span className="ml-1 text-amber-600">⚠</span>}
                  </span>
                ),
              },
              {
                key: 'ultimo',
                label: 'Último abastecimento',
                sortValue: (r) => r.ultimoAbastecimento ?? '',
                render: (r) => (r.ultimoAbastecimento ? fmtDate(r.ultimoAbastecimento) : '—'),
              },
              {
                key: 'dias',
                label: 'Dias sem abastecer',
                align: 'right',
                sortValue: (r) => r.diasSemAbastecer ?? -1,
                render: (r) => (
                  <span className={r.diasSemAbastecer != null && r.diasSemAbastecer >= 10 ? 'font-medium text-amber-700' : ''}>
                    {r.diasSemAbastecer ?? '—'}
                  </span>
                ),
              },
              {
                key: 'n',
                label: 'Nº abastecimentos',
                align: 'right',
                sortValue: (r) => r.nAbastecimentos,
                render: (r) => fmt(r.nAbastecimentos),
              },
            ]}
          />
        </>
      )}
    </div>
  )
}
