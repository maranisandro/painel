'use client'

import Link from 'next/link'
import { SortableTable, type SortableColumn } from '@/components/shared/SortableTable'

interface RitmoInfo {
  diasDoMes: number | null
  diasComFaturamento: number
  ritmoEsperado: number | null
  dentroDoRitmo: boolean | null
  projecaoFechamento: number | null
  diasUteisRestantes: number
  necessarioPorDiaUtil: number | null
}
interface ComparativoVolume {
  metaVolumeM3: number
  realizadoM3: number
  pctAtingido: number | null
  mesReferencia: string | null
  diasDoMes: number | null
  diasComFaturamento: number | null
  ritmoEsperadoM3: number | null
  dentroDoRitmo: boolean | null
  projecaoFechamentoM3: number | null
  diasUteisRestantes: number
  necessarioPorDiaUtilM3: number | null
}
interface ComparativoIcms {
  tabelaPreco: string
  metaPct: number | null
  realM3: number
  realPct: number | null
  minimoFaixa: number | null
  precoPraticado: number | null
  diferencaMinimo: number | null
}
interface ImpactoMixIcms {
  precoPonderadoMetaMix: number | null
  precoPonderadoRealMix: number | null
  diferenca: number | null
  impacto: 'beneficio' | 'malefico' | 'neutro' | null
}
interface ComparativoDistribuidorCota {
  codDistribuidor: string
  nomeDistribuidor: string | null
  metaValor: number
  realizado: number
  pctAtingido: number | null
  ritmo: RitmoInfo
}
interface ComparativoProdutoCota {
  codigoPrd: string
  nomeProduto: string | null
  cotaUnidades: number
  vendidoUnidades: number
  m3PorUnidade: number | null
  metaM3: number | null
  vendidoM3: number
  pctAtingido: number | null
  saldoFisico: number | null
  necessarioRestanteUnidades: number
  saldoSuficiente: boolean | null
  ritmo: RitmoInfo
  dentroDoRitmoEfetivo: boolean | null
}
interface ProdutoAcimaMeta {
  mes: string
  codigoPrd: string
  nomeProduto: string | null
  cotaUnidades: number
  vendidoUnidades: number
  excedenteUnidades: number
  excedentePct: number
}
interface MargemMes {
  mesReferencia: string
  precoM3Vendido: number | null
  custoProducaoM3: number | null
  despesasImpostosPct: number | null
  resultadoM3: number | null
  pctResultado: number | null
  m3TotalMes: number
  resultadoTotalMes: number | null
}
export interface ComparativoCotasData {
  temCadastro: boolean
  volume: ComparativoVolume
  icms: ComparativoIcms[]
  impactoMixIcms: ImpactoMixIcms
  distribuidores: ComparativoDistribuidorCota[]
  produtos: ComparativoProdutoCota[]
  produtosAcimaMeta: ProdutoAcimaMeta[]
  margemMes: MargemMes
}

function fmtMoeda(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}
function fmt(n: number, digits = 0): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: digits })
}
function fmtPct(n: number | null, digits = 0): string {
  return n == null ? '—' : `${fmt(n * 100, digits)}%`
}
function fmtMes(iso: string): string {
  const [ano, mes] = iso.split('-')
  if (!ano || !mes) return iso
  return `${mes}/${ano}`
}
function corAtingido(pct: number | null): string {
  if (pct == null) return 'text-slate-700'
  return pct >= 1 ? 'text-emerald-700' : pct >= 0.9 ? 'text-amber-700' : 'text-red-700'
}
/**
 * Cor pelo RITMO (dentro/fora do esperado até agora), não pela % crua do mês
 * inteiro — pedido do usuário 2026-08-13: "este item marcado em vermelho não
 * deveria estar verde visto que está acima da meta do ritmo?" (37,5% do mês
 * aparecia vermelho mesmo estando ACIMA do esperado para o dia 12 de um mês
 * de 31 dias). Cai para `corAtingido` só quando não há ritmo calculável
 * (sem meta cadastrada pro mês, por exemplo).
 */
function corPorRitmo(dentroDoRitmo: boolean | null, pctAtingidoFallback: number | null): string {
  if (dentroDoRitmo != null) return dentroDoRitmo ? 'text-emerald-700' : 'text-red-700'
  return corAtingido(pctAtingidoFallback)
}
/**
 * Mesmo critério de `corPorRitmo`, mas em classe de FUNDO (bg-*) — pedido do
 * usuário 2026-09-10: a barra de progresso e o "% vs. meta do mês" ainda
 * usavam a % crua do mês inteiro (`corAtingido`) mesmo com o texto do valor
 * já corrigido pelo ritmo em 2026-08-13, então a barra ficava vermelha/âmbar
 * cedo no mês mesmo estando ACIMA do ritmo esperado. "Só fica vermelho
 * abaixo da meta [do ritmo]" — binário (verde/vermelho), sem faixa
 * intermediária, ao contrário de `corAtingido` (que tem âmbar por não ter
 * ritmo pra comparar).
 */
function corFundoPorRitmo(dentroDoRitmo: boolean | null, pctAtingidoFallback: number | null): string {
  if (dentroDoRitmo != null) return dentroDoRitmo ? 'bg-emerald-600' : 'bg-red-500'
  return pctAtingidoFallback != null && pctAtingidoFallback >= 1 ? 'bg-emerald-600' : 'bg-red-500'
}

/**
 * Meta x realizado das cotas de venda cadastradas em Cadastros → Cotas de
 * venda — pedido do usuário 2026-08-13: "preciso que seja inserido na
 * analise por periodo e na analise estrategico os comparativos com as cotas
 * e com os parametros de distribuição por aliquota de ICMS". Reaproveitado
 * (mesmo componente) no tático e no estratégico — só muda o recorte de tempo
 * usado para somar as metas mensais cadastradas (`/lib/fase3/cotas.ts`).
 */
export function ComparativoCotas({ data, periodoLabel }: { data: ComparativoCotasData | null | undefined; periodoLabel: string }) {
  if (!data) return null

  if (!data.temCadastro) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm font-medium">Cotas de venda — meta x realizado</p>
        <p className="mt-1 text-sm text-slate-500">
          Nenhuma cota cadastrada para {periodoLabel}. Cadastre em{' '}
          <Link href="/dashboard/admin/cotas-venda" className="text-emerald-700 underline">
            Cadastros → Cotas de venda
          </Link>
          .
        </p>
      </div>
    )
  }

  const { volume, icms, impactoMixIcms, distribuidores, produtos, produtosAcimaMeta } = data

  const colunasDistribuidor: SortableColumn<ComparativoDistribuidorCota>[] = [
    {
      key: 'nome',
      label: 'Distribuidor',
      sortValue: (d) => d.nomeDistribuidor ?? d.codDistribuidor,
      render: (d) => (
        <>
          {d.nomeDistribuidor ?? d.codDistribuidor} <span className="text-slate-400">({d.codDistribuidor})</span>
        </>
      ),
    },
    { key: 'meta', label: 'Meta', align: 'right', sortValue: (d) => d.metaValor, render: (d) => fmtMoeda(d.metaValor) },
    { key: 'realizado', label: 'Realizado', align: 'right', sortValue: (d) => d.realizado, render: (d) => fmtMoeda(d.realizado) },
    {
      key: 'ritmoEsperado',
      label: 'Ritmo esperado',
      align: 'right',
      sortValue: (d) => d.ritmo.ritmoEsperado ?? 0,
      render: (d) => (d.ritmo.ritmoEsperado != null ? fmtMoeda(d.ritmo.ritmoEsperado) : '—'),
    },
    {
      key: 'projecao',
      label: 'Projeção fechamento',
      align: 'right',
      sortValue: (d) => d.ritmo.projecaoFechamento ?? 0,
      render: (d) => (d.ritmo.projecaoFechamento != null ? fmtMoeda(d.ritmo.projecaoFechamento) : '—'),
    },
    {
      key: 'necessario',
      label: 'Nec./dia útil',
      align: 'right',
      sortValue: (d) => d.ritmo.necessarioPorDiaUtil ?? 0,
      render: (d) =>
        d.ritmo.necessarioPorDiaUtil == null ? (
          '—'
        ) : d.ritmo.necessarioPorDiaUtil === 0 ? (
          <span className="text-emerald-700">meta já alcançada</span>
        ) : (
          fmtMoeda(d.ritmo.necessarioPorDiaUtil)
        ),
    },
    {
      key: 'pctAtingido',
      label: '% atingido',
      align: 'right',
      sortValue: (d) => d.pctAtingido ?? 0,
      render: (d) => <span className={`font-medium ${corPorRitmo(d.ritmo.dentroDoRitmo, d.pctAtingido)}`}>{fmtPct(d.pctAtingido, 1)}</span>,
    },
  ]

  const colunasProduto: SortableColumn<ComparativoProdutoCota>[] = [
    {
      key: 'nome',
      label: 'Produto',
      sortValue: (p) => p.nomeProduto ?? p.codigoPrd,
      render: (p) => (
        <>
          {p.nomeProduto ?? p.codigoPrd} <span className="text-slate-400">({p.codigoPrd})</span>
        </>
      ),
    },
    { key: 'cotaUnidades', label: 'Cota (un.)', align: 'right', sortValue: (p) => p.cotaUnidades, render: (p) => fmt(p.cotaUnidades) },
    {
      key: 'vendidoUnidades',
      label: 'Expedição (un.)',
      align: 'right',
      sortValue: (p) => p.vendidoUnidades,
      render: (p) => fmt(p.vendidoUnidades),
    },
    {
      key: 'pctAtingido',
      label: '% atingido',
      align: 'right',
      sortValue: (p) => p.pctAtingido ?? 0,
      render: (p) => <span className={`font-medium ${corPorRitmo(p.dentroDoRitmoEfetivo, p.pctAtingido)}`}>{fmtPct(p.pctAtingido, 1)}</span>,
    },
    {
      key: 'ritmo',
      label: 'Ritmo do mês',
      align: 'center',
      sortValue: (p) => (p.dentroDoRitmoEfetivo == null ? 1 : p.dentroDoRitmoEfetivo ? 2 : 0),
      render: (p) => {
        if (p.ritmo.ritmoEsperado == null) return <span className="text-slate-400">sem cota do mês</span>
        if (p.dentroDoRitmoEfetivo === false) {
          return (
            <span className="rounded bg-red-100 px-1.5 py-0.5 font-medium text-red-700">
              Atrasado (esperado {fmt(p.ritmo.ritmoEsperado)} un.)
            </span>
          )
        }
        if (p.saldoSuficiente === true && p.ritmo.dentroDoRitmo === false) {
          return <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-800">Coberto por estoque</span>
        }
        return <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-800">No ritmo</span>
      },
    },
    {
      key: 'necessarioRestanteUnidades',
      label: 'Falta vender (un.)',
      align: 'right',
      sortValue: (p) => p.necessarioRestanteUnidades,
      render: (p) => fmt(p.necessarioRestanteUnidades),
    },
    {
      key: 'saldoFisico',
      label: 'Saldo em estoque (un.)',
      align: 'right',
      sortValue: (p) => p.saldoFisico ?? -1,
      render: (p) => (p.saldoFisico != null ? fmt(p.saldoFisico) : <span className="text-slate-400">—</span>),
    },
    {
      key: 'saldoSuficiente',
      label: 'Estoque p/ bater a cota',
      align: 'center',
      sortValue: (p) => (p.saldoSuficiente == null ? 1 : p.saldoSuficiente ? 2 : 0),
      render: (p) =>
        p.saldoSuficiente == null ? (
          <span className="text-slate-400">sem dado</span>
        ) : p.saldoSuficiente ? (
          <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-800">Suficiente</span>
        ) : (
          <span className="rounded bg-red-100 px-1.5 py-0.5 font-medium text-red-700">
            Insuficiente (faltam {fmt((p.necessarioRestanteUnidades - (p.saldoFisico ?? 0)))})
          </span>
        ),
    },
  ]

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-medium">Cotas de venda — meta x realizado ({periodoLabel})</p>
        <Link href="/dashboard/admin/cotas-venda" className="text-xs text-emerald-700 underline">
          gerenciar cotas
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs text-slate-500">Meta de volume (madeira tratada)</p>
          <p className={`text-lg font-semibold ${corPorRitmo(volume.dentroDoRitmo, volume.pctAtingido)}`}>{fmt(volume.realizadoM3, 1)} m³</p>
          <p className="text-xs text-slate-500">
            meta {fmt(volume.metaVolumeM3, 0)} m³ · {fmtPct(volume.pctAtingido)} atingido
          </p>
          {/* Barra com o % de diferença entre o vendido e a meta do mês — pedido do usuário 2026-08-13. */}
          {volume.pctAtingido != null && (
            <div className="mt-1.5">
              <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                <div
                  className={`h-full ${corFundoPorRitmo(volume.dentroDoRitmo, volume.pctAtingido)}`}
                  style={{ width: `${Math.min(100, volume.pctAtingido * 100)}%` }}
                />
              </div>
              <p className={`mt-0.5 text-xs font-medium ${corPorRitmo(volume.dentroDoRitmo, volume.pctAtingido)}`}>
                {volume.pctAtingido >= 1 ? '+' : ''}
                {fmt((volume.pctAtingido - 1) * 100, 1)}% vs. meta do mês
              </p>
            </div>
          )}
          {volume.ritmoEsperadoM3 != null && (
            <p className={`mt-1 text-xs font-medium ${volume.dentroDoRitmo ? 'text-emerald-700' : 'text-red-700'}`}>
              {volume.dentroDoRitmo ? '✓' : '⚠'} ritmo do mês ({volume.diasComFaturamento}/{volume.diasDoMes} dias com
              venda): esperado {fmt(volume.ritmoEsperadoM3, 0)} m³
              {volume.projecaoFechamentoM3 != null && (
                <> · projeção de fechamento {fmt(volume.projecaoFechamentoM3, 0)} m³</>
              )}
            </p>
          )}
          {volume.necessarioPorDiaUtilM3 != null && (
            <p className="mt-0.5 text-xs text-slate-500">
              {volume.necessarioPorDiaUtilM3 === 0
                ? 'meta já alcançada'
                : `precisa vender ${fmt(volume.necessarioPorDiaUtilM3, 1)} m³/dia útil (${volume.diasUteisRestantes} dias úteis restantes) para bater a meta`}
            </p>
          )}
        </div>
        {icms.map((t) => (
          <div key={t.tabelaPreco} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs text-slate-500">{t.tabelaPreco} — mix de volume</p>
            <p
              className={`text-lg font-semibold ${
                t.metaPct != null && t.realPct != null && Math.abs(t.realPct - t.metaPct) > 5 ? 'text-red-700' : ''
              }`}
            >
              {t.realPct != null ? `${fmt(t.realPct, 1)}%` : '—'}
            </p>
            <p className="text-xs text-slate-500">
              meta {t.metaPct != null ? `${fmt(t.metaPct, 1)}%` : '—'} · {fmt(t.realM3, 1)} m³
            </p>
            {t.minimoFaixa != null && <p className="mt-1 text-xs text-slate-400">mínimo da faixa {fmtMoeda(t.minimoFaixa)}/m³</p>}
            {t.precoPraticado != null && (
              <p className={`text-xs ${t.diferencaMinimo != null && t.diferencaMinimo < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                praticado {fmtMoeda(t.precoPraticado)}/m³
                {t.diferencaMinimo != null && (
                  <> ({t.diferencaMinimo >= 0 ? '+' : ''}{fmtMoeda(t.diferencaMinimo)} vs. mínimo)</>
                )}
              </p>
            )}
          </div>
        ))}
      </div>

      {impactoMixIcms.impacto != null && impactoMixIcms.impacto !== 'neutro' && (
        <div
          className={`rounded-lg border px-3 py-2 text-xs ${
            impactoMixIcms.impacto === 'beneficio' ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-red-300 bg-red-50 text-red-900'
          }`}
        >
          <strong>{impactoMixIcms.impacto === 'beneficio' ? 'Mix de ICMS favorável' : 'Mix de ICMS desfavorável'}</strong> ao
          preço mínimo ponderado: a distribuição real entre as faixas de ICMS resultaria num mínimo de{' '}
          {fmtMoeda(impactoMixIcms.precoPonderadoRealMix ?? 0)}/m³, {impactoMixIcms.impacto === 'beneficio' ? 'abaixo' : 'acima'}{' '}
          do mínimo que a meta de distribuição do mês pressupõe ({fmtMoeda(impactoMixIcms.precoPonderadoMetaMix ?? 0)}/m³) —{' '}
          {impactoMixIcms.impacto === 'beneficio'
            ? 'mais fácil vender acima do mínimo com esse mix'
            : 'mais difícil vender acima do mínimo com esse mix'}
          , independente do preço praticado em cada faixa.
        </div>
      )}

      {distribuidores.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium text-slate-600">Por distribuidor (R$)</p>
          <div className="overflow-x-auto rounded-lg border border-slate-200 text-xs">
            <SortableTable
              columns={colunasDistribuidor}
              rows={distribuidores}
              rowKey={(d) => d.codDistribuidor}
              defaultSortKey="pctAtingido"
              defaultSortDir="asc"
              emptyMessage="Nenhuma meta cadastrada."
            />
          </div>
        </div>
      )}

      {produtos.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium text-slate-600">Por produto</p>
          {(() => {
            const insuficientes = produtos.filter((p) => p.saldoSuficiente === false)
            return insuficientes.length > 0 ? (
              <p className="mb-2 rounded-md border border-red-300 bg-red-50 px-2 py-1.5 text-xs text-red-900">
                <strong>{insuficientes.length} produto(s)</strong> com saldo em estoque insuficiente para bater a cota
                do mês, mesmo vendendo tudo o que resta em saldo — repor estoque ou revisar a cota destes produtos.
              </p>
            ) : null
          })()}
          <div className="max-h-96 overflow-y-auto overflow-x-auto rounded-lg border border-slate-200 text-xs">
            <SortableTable
              columns={colunasProduto}
              rows={produtos}
              rowKey={(p) => p.codigoPrd}
              defaultSortKey="pctAtingido"
              defaultSortDir="asc"
              emptyMessage="Nenhuma cota cadastrada."
            />
          </div>
        </div>
      )}

      {produtosAcimaMeta.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium text-slate-600">Produtos consumindo acima da meta do mês</p>
          <p className="mb-2 text-xs text-slate-500">
            Um produto pode estourar a cota num mês específico mesmo sem estourar a cota do período/ano somado —
            útil pra saber se o estoque planejado pra meses seguintes está sendo consumido adiantado.
          </p>
          <div className="max-h-72 overflow-y-auto overflow-x-auto rounded-lg border border-slate-200 text-xs">
            <table className="w-full">
              <thead className="sticky top-0 z-10 bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-3 py-2">Mês</th>
                  <th className="px-3 py-2">Produto</th>
                  <th className="px-3 py-2 text-right">Cota do mês (un.)</th>
                  <th className="px-3 py-2 text-right">Vendido (un.)</th>
                  <th className="px-3 py-2 text-right">Excedente</th>
                </tr>
              </thead>
              <tbody>
                {produtosAcimaMeta.map((p) => (
                  <tr key={`${p.mes}|${p.codigoPrd}`} className="border-t border-slate-100">
                    <td className="px-3 py-2">{fmtMes(p.mes)}</td>
                    <td className="px-3 py-2">
                      {p.nomeProduto ?? p.codigoPrd} <span className="text-slate-400">({p.codigoPrd})</span>
                    </td>
                    <td className="px-3 py-2 text-right">{fmt(p.cotaUnidades)}</td>
                    <td className="px-3 py-2 text-right">{fmt(p.vendidoUnidades)}</td>
                    <td className="px-3 py-2 text-right font-medium text-amber-800">
                      +{fmt(p.excedenteUnidades)} ({fmtPct(p.excedentePct, 1)})
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
