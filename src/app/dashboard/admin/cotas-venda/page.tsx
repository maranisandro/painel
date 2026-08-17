'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ExcelButtons } from '@/components/admin/ExcelButtons'

interface QuotaSettings {
  id: string
  month: string
  metaVolumeM3: string
  icms7Pct: string
  icms12Pct: string
  icms18Pct: string
}

interface DistributorQuota {
  id: string
  month: string
  codDistribuidor: string
  nomeDistribuidor: string | null
  metaValor: string
}

interface ProductQuota {
  id: string
  month: string
  codigoPrd: string
  nomeProduto: string | null
  m3PorUnidade: string | null
  cotaUnidades: string
}

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(m: string): string {
  const [y, mm] = m.split('-')
  const nomes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
  return `${nomes[Number(mm) - 1]}/${y}`
}

function fmtMoney(v: string | number): string {
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

export default function CotasVendaPage() {
  const [month, setMonth] = useState(currentMonth())

  const [settings, setSettings] = useState<QuotaSettings | null>(null)
  const [settingsForm, setSettingsForm] = useState({ metaVolumeM3: '', icms7Pct: '', icms12Pct: '', icms18Pct: '' })
  const [settingsError, setSettingsError] = useState('')
  const [settingsSaving, setSettingsSaving] = useState(false)

  const [distribuidores, setDistribuidores] = useState<DistributorQuota[]>([])
  const [distForm, setDistForm] = useState({ codDistribuidor: '', nomeDistribuidor: '', metaValor: '' })
  const [distError, setDistError] = useState('')
  const [distSaving, setDistSaving] = useState(false)

  const [produtos, setProdutos] = useState<ProductQuota[]>([])
  const [prodForm, setProdForm] = useState({ codigoPrd: '', nomeProduto: '', m3PorUnidade: '', cotaUnidades: '' })
  const [prodError, setProdError] = useState('')
  const [prodSaving, setProdSaving] = useState(false)
  const [prodFilter, setProdFilter] = useState('')

  const load = useCallback(async (m: string) => {
    const [s, d, p] = await Promise.all([
      fetch(`/api/admin/quota-settings?month=${m}`),
      fetch(`/api/admin/distributor-quotas?month=${m}`),
      fetch(`/api/admin/product-quotas?month=${m}`),
    ])
    const settingsRows: QuotaSettings[] = s.ok ? await s.json() : []
    const found = settingsRows[0] ?? null
    setSettings(found)
    setSettingsForm(
      found
        ? {
            metaVolumeM3: found.metaVolumeM3,
            icms7Pct: found.icms7Pct,
            icms12Pct: found.icms12Pct,
            icms18Pct: found.icms18Pct,
          }
        : { metaVolumeM3: '5000', icms7Pct: '60.04', icms12Pct: '4.46', icms18Pct: '35.5' },
    )
    setDistribuidores(d.ok ? await d.json() : [])
    setProdutos(p.ok ? await p.json() : [])
  }, [])

  useEffect(() => {
    void load(month)
  }, [month, load])

  const somaIcms =
    (Number(settingsForm.icms7Pct) || 0) + (Number(settingsForm.icms12Pct) || 0) + (Number(settingsForm.icms18Pct) || 0)

  async function salvarSettings() {
    setSettingsSaving(true)
    setSettingsError('')
    const res = await fetch('/api/admin/quota-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        month,
        metaVolumeM3: Number(settingsForm.metaVolumeM3),
        icms7Pct: Number(settingsForm.icms7Pct),
        icms12Pct: Number(settingsForm.icms12Pct),
        icms18Pct: Number(settingsForm.icms18Pct),
      }),
    })
    setSettingsSaving(false)
    if (!res.ok) {
      setSettingsError((await res.json()).error ?? 'Erro ao salvar')
      return
    }
    await load(month)
  }

  async function adicionarDistribuidor() {
    if (!distForm.codDistribuidor || !distForm.metaValor) return
    setDistSaving(true)
    setDistError('')
    const res = await fetch('/api/admin/distributor-quotas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        month,
        codDistribuidor: distForm.codDistribuidor.trim(),
        nomeDistribuidor: distForm.nomeDistribuidor.trim() || null,
        metaValor: Number(distForm.metaValor),
      }),
    })
    setDistSaving(false)
    if (!res.ok) {
      setDistError((await res.json()).error ?? 'Erro ao salvar')
      return
    }
    setDistForm({ codDistribuidor: '', nomeDistribuidor: '', metaValor: '' })
    await load(month)
  }

  async function excluirDistribuidor(id: string) {
    await fetch(`/api/admin/distributor-quotas/${id}`, { method: 'DELETE' })
    await load(month)
  }

  async function editarNomeDistribuidor(d: DistributorQuota) {
    const novoNome = window.prompt('Nome de exibição do distribuidor:', d.nomeDistribuidor ?? '')
    if (novoNome === null) return
    await fetch(`/api/admin/distributor-quotas/${d.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ metaValor: Number(d.metaValor), nomeDistribuidor: novoNome.trim() || null }),
    })
    await load(month)
  }

  async function copiarDistribuidoresMesAnterior() {
    setDistError('')
    const res = await fetch('/api/admin/distributor-quotas/copy-month', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ month }),
    })
    if (!res.ok) {
      setDistError((await res.json()).error ?? 'Erro ao copiar')
      return
    }
    await load(month)
  }

  async function adicionarProduto() {
    if (!prodForm.codigoPrd || !prodForm.cotaUnidades) return
    setProdSaving(true)
    setProdError('')
    const res = await fetch('/api/admin/product-quotas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        month,
        codigoPrd: prodForm.codigoPrd.trim(),
        nomeProduto: prodForm.nomeProduto.trim() || null,
        m3PorUnidade: prodForm.m3PorUnidade ? Number(prodForm.m3PorUnidade) : null,
        cotaUnidades: Number(prodForm.cotaUnidades),
      }),
    })
    setProdSaving(false)
    if (!res.ok) {
      setProdError((await res.json()).error ?? 'Erro ao salvar')
      return
    }
    setProdForm({ codigoPrd: '', nomeProduto: '', m3PorUnidade: '', cotaUnidades: '' })
    await load(month)
  }

  async function excluirProduto(id: string) {
    await fetch(`/api/admin/product-quotas/${id}`, { method: 'DELETE' })
    await load(month)
  }

  async function copiarProdutosMesAnterior() {
    setProdError('')
    const res = await fetch('/api/admin/product-quotas/copy-month', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ month }),
    })
    if (!res.ok) {
      setProdError((await res.json()).error ?? 'Erro ao copiar')
      return
    }
    await load(month)
  }

  async function importarProdutos(rows: Record<string, string>[]): Promise<string> {
    let criados = 0
    let erros = 0
    for (const row of rows) {
      const codigoPrd = row['Código do Produto'] ?? row['codigoPrd']
      const cotaUnidades = row['Cota Mensal'] ?? row['cotaUnidades']
      if (!codigoPrd || !cotaUnidades) {
        erros++
        continue
      }
      const res = await fetch('/api/admin/product-quotas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          month,
          codigoPrd: codigoPrd.trim(),
          nomeProduto: row['Nome Fantasia'] ?? row['nomeProduto'] ?? null,
          m3PorUnidade: row['M3'] ? Number(row['M3'].replace(',', '.')) : null,
          cotaUnidades: Number(cotaUnidades.replace(',', '.')),
        }),
      })
      if (res.ok) criados++
      else erros++
    }
    await load(month)
    return `${criados} produto(s) importado(s)${erros > 0 ? `, ${erros} erro(s) (já cadastrado ou linha inválida)` : ''}.`
  }

  const produtosFiltrados = useMemo(() => {
    const f = prodFilter.trim().toUpperCase()
    if (!f) return produtos
    return produtos.filter(
      (p) => p.codigoPrd.toUpperCase().includes(f) || (p.nomeProduto ?? '').toUpperCase().includes(f),
    )
  }, [produtos, prodFilter])

  const totalM3Produtos = produtos.reduce(
    (s, p) => s + (p.m3PorUnidade ? Number(p.cotaUnidades) * Number(p.m3PorUnidade) : 0),
    0,
  )
  const produtosSemM3 = produtos.filter((p) => !p.m3PorUnidade).length

  return (
    <div>
      <h1 className="text-xl font-semibold">Cotas de venda — Madeira Tratada</h1>
      <p className="mt-1 text-sm text-slate-500">
        Metas mensais ajustáveis: volume total, distribuição por faixa de ICMS, meta por distribuidor e por produto.
      </p>

      <div className="mt-4 flex items-center gap-2">
        <label className="text-sm font-medium text-slate-600">Mês</label>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
        <span className="text-sm text-slate-500">{monthLabel(month)}</span>
      </div>

      {/* Configuração geral do mês */}
      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-medium">Configuração do mês</h2>
        <p className="mt-1 text-xs text-slate-500">
          Meta de volume total (linha inteira de madeira tratada) e distribuição-alvo entre as faixas de ICMS que o
          sistema já calcula pelo estado do cliente (7%, 12%, 18% — não existe faixa de 20%).
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <label className="block text-xs font-medium text-slate-600">Meta volume (m³/mês)</label>
            <input
              type="number"
              value={settingsForm.metaVolumeM3}
              onChange={(e) => setSettingsForm((f) => ({ ...f, metaVolumeM3: e.target.value }))}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">% ICMS 7%</label>
            <input
              type="number"
              value={settingsForm.icms7Pct}
              onChange={(e) => setSettingsForm((f) => ({ ...f, icms7Pct: e.target.value }))}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">% ICMS 12%</label>
            <input
              type="number"
              value={settingsForm.icms12Pct}
              onChange={(e) => setSettingsForm((f) => ({ ...f, icms12Pct: e.target.value }))}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">% ICMS 18%</label>
            <input
              type="number"
              value={settingsForm.icms18Pct}
              onChange={(e) => setSettingsForm((f) => ({ ...f, icms18Pct: e.target.value }))}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
        </div>
        <p className={`mt-2 text-xs ${Math.abs(somaIcms - 100) > 0.1 ? 'text-red-600' : 'text-slate-500'}`}>
          Soma das 3 faixas: {somaIcms}% {Math.abs(somaIcms - 100) > 0.1 && '— precisa somar 100%'}
        </p>
        {settingsError && <p className="mt-2 text-sm text-red-600">{settingsError}</p>}
        <button
          onClick={salvarSettings}
          disabled={settingsSaving}
          className="mt-3 rounded-md bg-emerald-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          {settingsSaving ? 'Salvando…' : settings ? 'Atualizar mês' : 'Salvar mês'}
        </button>
      </section>

      {/* Cotas por distribuidor */}
      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Meta por distribuidor (R$)</h2>
          <button
            onClick={copiarDistribuidoresMesAnterior}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-100"
          >
            Copiar do mês anterior
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-xs font-medium text-slate-600">Cód. distribuidor</label>
            <input
              value={distForm.codDistribuidor}
              onChange={(e) => setDistForm((f) => ({ ...f, codDistribuidor: e.target.value }))}
              placeholder="C00003154"
              className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Nome (opcional)</label>
            <input
              value={distForm.nomeDistribuidor}
              onChange={(e) => setDistForm((f) => ({ ...f, nomeDistribuidor: e.target.value }))}
              className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Meta (R$)</label>
            <input
              type="number"
              value={distForm.metaValor}
              onChange={(e) => setDistForm((f) => ({ ...f, metaValor: e.target.value }))}
              className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <button
            onClick={adicionarDistribuidor}
            disabled={distSaving}
            className="rounded-md bg-emerald-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            Adicionar
          </button>
        </div>
        {distError && <p className="mt-2 text-sm text-red-600">{distError}</p>}
        <table className="mt-3 w-full text-sm">
          <thead className="text-left text-slate-600">
            <tr>
              <th className="px-2 py-1">Código</th>
              <th className="px-2 py-1">Nome</th>
              <th className="px-2 py-1 text-right">Meta</th>
              <th className="px-2 py-1"></th>
            </tr>
          </thead>
          <tbody>
            {distribuidores.map((d) => (
              <tr key={d.id} className="border-t border-slate-100">
                <td className="px-2 py-1 font-mono">{d.codDistribuidor}</td>
                <td className="px-2 py-1">
                  <button onClick={() => editarNomeDistribuidor(d)} className="text-left hover:underline" title="Clique para editar o nome">
                    {d.nomeDistribuidor ?? <span className="text-amber-600">sem nome — clique para definir</span>}
                  </button>
                </td>
                <td className="px-2 py-1 text-right">{fmtMoney(d.metaValor)}</td>
                <td className="px-2 py-1 text-right">
                  <button onClick={() => excluirDistribuidor(d.id)} className="text-red-600 hover:underline">
                    excluir
                  </button>
                </td>
              </tr>
            ))}
            {distribuidores.length === 0 && (
              <tr>
                <td colSpan={4} className="px-2 py-6 text-center text-slate-500">
                  Nenhuma meta cadastrada para {monthLabel(month)}.
                </td>
              </tr>
            )}
          </tbody>
          {distribuidores.length > 0 && (
            <tfoot>
              <tr className="border-t border-slate-200 font-medium">
                <td className="px-2 py-1" colSpan={2}>
                  Total
                </td>
                <td className="px-2 py-1 text-right">
                  {fmtMoney(distribuidores.reduce((s, d) => s + Number(d.metaValor), 0))}
                </td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </section>

      {/* Cotas por produto */}
      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">Cota por produto (unidades)</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={copiarProdutosMesAnterior}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-100"
            >
              Copiar do mês anterior
            </button>
            <ExcelButtons
              exportFilename={`cotas-produto-${month}`}
              exportRows={() =>
                produtos.map((p) => ({
                  'Código do Produto': p.codigoPrd,
                  'Nome Fantasia': p.nomeProduto ?? '',
                  M3: p.m3PorUnidade ?? '',
                  'Cota Mensal': p.cotaUnidades,
                }))
              }
              onImport={importarProdutos}
            />
          </div>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          M3 (fator m³ por unidade) é opcional — quando ausente, este produto entra na meta de unidades mas não
          conta no total de m³ (fator não confiável na origem para vários produtos, ver aba Crítica ao modelo).
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-xs font-medium text-slate-600">Código do produto</label>
            <input
              value={prodForm.codigoPrd}
              onChange={(e) => setProdForm((f) => ({ ...f, codigoPrd: e.target.value }))}
              placeholder="95.02.070006"
              className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Nome (opcional)</label>
            <input
              value={prodForm.nomeProduto}
              onChange={(e) => setProdForm((f) => ({ ...f, nomeProduto: e.target.value }))}
              className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">M3/unidade (opcional)</label>
            <input
              type="number"
              step="0.0001"
              value={prodForm.m3PorUnidade}
              onChange={(e) => setProdForm((f) => ({ ...f, m3PorUnidade: e.target.value }))}
              className="mt-1 w-28 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Cota (unidades)</label>
            <input
              type="number"
              value={prodForm.cotaUnidades}
              onChange={(e) => setProdForm((f) => ({ ...f, cotaUnidades: e.target.value }))}
              className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <button
            onClick={adicionarProduto}
            disabled={prodSaving}
            className="rounded-md bg-emerald-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            Adicionar
          </button>
        </div>
        {prodError && <p className="mt-2 text-sm text-red-600">{prodError}</p>}
        <input
          value={prodFilter}
          onChange={(e) => setProdFilter(e.target.value)}
          placeholder="Filtrar por código ou nome…"
          className="mt-3 w-full max-w-xs rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
        <div className="mt-2 max-h-[480px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white text-left text-slate-600">
              <tr>
                <th className="px-2 py-1">Código</th>
                <th className="px-2 py-1">Nome</th>
                <th className="px-2 py-1 text-right">M3/un.</th>
                <th className="px-2 py-1 text-right">Cota (un.)</th>
                <th className="px-2 py-1 text-right">Cota (m³)</th>
                <th className="px-2 py-1"></th>
              </tr>
            </thead>
            <tbody>
              {produtosFiltrados.map((p) => (
                <tr key={p.id} className="border-t border-slate-100">
                  <td className="px-2 py-1 font-mono">{p.codigoPrd}</td>
                  <td className="px-2 py-1">{p.nomeProduto ?? '—'}</td>
                  <td className="px-2 py-1 text-right">{p.m3PorUnidade ?? <span className="text-amber-600">—</span>}</td>
                  <td className="px-2 py-1 text-right">{Number(p.cotaUnidades).toLocaleString('pt-BR')}</td>
                  <td className="px-2 py-1 text-right">
                    {p.m3PorUnidade
                      ? (Number(p.cotaUnidades) * Number(p.m3PorUnidade)).toLocaleString('pt-BR', {
                          maximumFractionDigits: 1,
                        })
                      : '—'}
                  </td>
                  <td className="px-2 py-1 text-right">
                    <button onClick={() => excluirProduto(p.id)} className="text-red-600 hover:underline">
                      excluir
                    </button>
                  </td>
                </tr>
              ))}
              {produtosFiltrados.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-2 py-6 text-center text-slate-500">
                    Nenhuma cota cadastrada para {monthLabel(month)}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {produtos.length > 0 && (
          <p className="mt-2 text-xs text-slate-500">
            Total m³ pelas cotas de produto: <strong>{totalM3Produtos.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} m³</strong>
            {produtosSemM3 > 0 && ` (${produtosSemM3} produto(s) sem fator m³ cadastrado, não entram nesta soma)`}
            {settings && (
              <>
                {' '}— meta do mês: <strong>{Number(settings.metaVolumeM3).toLocaleString('pt-BR')} m³</strong>
                {Math.abs(totalM3Produtos - Number(settings.metaVolumeM3)) > Number(settings.metaVolumeM3) * 0.05 && (
                  <span className="text-amber-600"> · diferença de mais de 5% em relação à meta total</span>
                )}
              </>
            )}
          </p>
        )}
      </section>
    </div>
  )
}
