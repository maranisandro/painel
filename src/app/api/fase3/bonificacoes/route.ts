import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, hasModuleAccess } from '@/lib/authz'
import { getDatasetView } from '@/lib/semantic/dataset-view'
import { prepararVendas, bonificacoesSemTabela4 } from '@/lib/fase3/faturamento'
import { resolverConfigVendas } from '@/lib/fase3/cotas'
import { aplicarEscopoUsuario } from '@/lib/fase3/escopo-usuario'

function monthStart(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}
function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Fase 3 — Destino das bonificações: pedido do usuário 2026-08-04 ("como
 * você encontrou venda como bonificação preciso que marque estas vendas
 * bonificadas e para quais clientes estão indo estas bonificações... crie
 * uma seção para ver o destino de bonificações por distribuidor"). Usa
 * `bonificacaoOriginal` (marca CODTMV=2.2.48 na origem) em vez de
 * `tipoMovimento`, porque a Planep é reclassificada como venda normal para
 * fins de faturamento/m³, mas continua sendo uma bonificação de origem que
 * o usuário quer enxergar aqui.
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser()
  if (!hasModuleAccess(user, 'fase3')) return NextResponse.json({ error: 'acesso negado' }, { status: 403 })

  const from = req.nextUrl.searchParams.get('from') || monthStart()
  const to = req.nextUrl.searchParams.get('to') || todayStr()

  const config = await resolverConfigVendas()
  let linhasPeriodo: ReturnType<typeof prepararVendas> = []
  try {
    const view = await getDatasetView('fase3_vendas_madeira_tratada')
    linhasPeriodo = aplicarEscopoUsuario(prepararVendas(view, from, to, config), user!.escopoVendas)
  } catch {
    linhasPeriodo = []
  }

  const bonificacoes = linhasPeriodo.filter((l) => l.bonificacaoOriginal)

  const porDistribuidorCliente = new Map<
    string,
    { distribuidor: string; cliente: string; n: number; quantidade: number; valorNominal: number; diferencaTabela4: number }
  >()
  for (const l of bonificacoes) {
    const chave = `${l.distribuidor}|${l.cliente || '—'}`
    const e = porDistribuidorCliente.get(chave) ?? {
      distribuidor: l.distribuidor,
      cliente: l.cliente || '—',
      n: 0,
      quantidade: 0,
      valorNominal: 0,
      diferencaTabela4: 0,
    }
    e.n++
    e.quantidade += l.quantidade
    e.valorNominal += l.quantidade * (l.valorBruto / (l.quantidade || 1))
    e.diferencaTabela4 += (l.precoMedioTabela4 - l.valorBruto / (l.quantidade || 1)) * l.quantidade
    porDistribuidorCliente.set(chave, e)
  }

  const porDistribuidor = new Map<string, { distribuidor: string; n: number; valorNominal: number; regraViolada: boolean }>()
  for (const e of porDistribuidorCliente.values()) {
    const d = porDistribuidor.get(e.distribuidor) ?? {
      distribuidor: e.distribuidor,
      n: 0,
      valorNominal: 0,
      regraViolada: e.distribuidor === 'PLANEP',
    }
    d.n += e.n
    d.valorNominal += e.valorNominal
    porDistribuidor.set(e.distribuidor, d)
  }

  const linhasDetalhe = bonificacoes
    .map((l) => ({
      data: l.data,
      distribuidor: l.distribuidor,
      cliente: l.cliente,
      produto: l.produto,
      quantidade: l.quantidade,
      precoVendido: l.valorBruto / (l.quantidade || 1),
      valorNominal: l.valorBruto,
      precoMedioTabela4: l.precoMedioTabela4,
      diferenca: (l.precoMedioTabela4 - l.valorBruto / (l.quantidade || 1)) * l.quantidade,
    }))
    .sort((a, b) => b.data.localeCompare(a.data))

  const semTabela4 = bonificacoesSemTabela4(linhasPeriodo)

  // Pedido do usuário 2026-08-05: "precisamos ter a informação do que gerou
  // bonificação e o que foi faturado em bonificação" — duas visões lado a
  // lado: `totalNominal` é o valor NOMINAL efetivamente lançado como
  // bonificação (preço vendido × quantidade); `totalTabela4` é o que a
  // venda VALERIA pelo preço de tabela do distribuidor (a referência que
  // "gerou" o desconto/bonificação) — a diferença entre os dois é o quanto
  // a bonificação de fato representa em desconto sobre o preço de tabela.
  const totalTabela4 = bonificacoes.reduce((s, l) => s + l.precoMedioTabela4 * l.quantidade, 0)

  // Gráfico evolutivo (pedido do usuário: "sempre que colocar um período
  // maior que o mensal fazer um gráfico evolutivo") — só computado quando o
  // período pedido cobre mais de ~31 dias (o front decide se mostra).
  const porMes = new Map<string, { nominal: number; tabela4: number; transacoes: number }>()
  for (const l of bonificacoes) {
    const mes = l.mes
    const e = porMes.get(mes) ?? { nominal: 0, tabela4: 0, transacoes: 0 }
    e.nominal += l.valorBruto
    e.tabela4 += l.precoMedioTabela4 * l.quantidade
    e.transacoes += 1
    porMes.set(mes, e)
  }
  const evolucaoMensal = [...porMes.entries()]
    .map(([mes, e]) => ({ mes, ...e }))
    .sort((a, b) => a.mes.localeCompare(b.mes))

  return NextResponse.json({
    period: { from, to },
    totalNominal: bonificacoes.reduce((s, l) => s + l.valorBruto, 0),
    totalTabela4,
    totalTransacoes: bonificacoes.length,
    evolucaoMensal,
    porDistribuidor: [...porDistribuidor.values()].sort((a, b) => b.valorNominal - a.valorNominal),
    porDistribuidorCliente: [...porDistribuidorCliente.values()].sort((a, b) => b.valorNominal - a.valorNominal),
    linhasDetalhe,
    semTabela4,
    totalSemTabela4: semTabela4.length,
  })
}
