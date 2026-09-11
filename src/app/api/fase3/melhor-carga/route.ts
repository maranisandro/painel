import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, hasModuleAccess } from '@/lib/authz'
import { getDatasetView } from '@/lib/semantic/dataset-view'
import { prepararVendas, agruparCargas } from '@/lib/fase3/faturamento'
import { resolverConfigVendas } from '@/lib/fase3/cotas'
import { aplicarEscopoUsuario } from '@/lib/fase3/escopo-usuario'

function monthStart(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}
function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

// Cargas muito pequenas (poucos m³) distorcem o ranking de "melhor carga"
// por terem denominador quase zero — pedido do usuário é sobre a carga
// típica de caminhão (RodoTrem/Rodocaçamba), não sobras/complementos.
const M3_MINIMO_CARGA = 3

/**
 * Fase 3 — Melhor carga: pedido do usuário 2026-08-04 ("montar uma análise
 * estratégica de qual a melhor carga, com melhor preço por m³ ponderado
 * entre mourão e peças de acordo com as alíquotas de ICMS, quero entender
 * qual a minha melhor venda"). Junta as notas da mesma placa no mesmo dia
 * (`agruparCargas` — RodoTrem/Rodocaçamba exigem 2 NFs) e ranqueia por
 * preço/m³ realizado vs mínimo ponderado daquela carga.
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser()
  if (!hasModuleAccess(user, 'fase3')) return NextResponse.json({ error: 'acesso negado' }, { status: 403 })

  const from = req.nextUrl.searchParams.get('from') || monthStart()
  const to = req.nextUrl.searchParams.get('to') || todayStr()
  const categoriasParam = req.nextUrl.searchParams.get('categorias')
  const categoriasSelecionadas = categoriasParam ? categoriasParam.split(',').filter(Boolean) : null

  const config = await resolverConfigVendas()
  let linhas: ReturnType<typeof prepararVendas> = []
  try {
    const view = await getDatasetView('fase3_vendas_madeira_tratada')
    linhas = aplicarEscopoUsuario(prepararVendas(view, from, to, config), user!.escopoVendas)
  } catch {
    linhas = []
  }
  if (categoriasSelecionadas) linhas = linhas.filter((l) => categoriasSelecionadas.includes(l.tipoProduto))

  const { cargas, linhasSemPlaca } = agruparCargas(linhas)
  const cargasRelevantes = cargas.filter((c) => c.m3Total >= M3_MINIMO_CARGA && c.valorM3 != null)

  // Pedido original do usuário (nota Fase 3): comparar Mourão x Peças por
  // alíquota de ICMS — só ficou possível em 2026-08-04 depois de implementar
  // o SubTipoProduto (releitura da nota mostrou que "Peças" é qualquer
  // Agronegócio sem "2,20" no nome, não uma palavra literal no produto).
  const porSubTipoProdutoTabela = new Map<string, { subTipoProduto: string; tabelaPreco: string; n: number; m3Total: number; faturamento: number; m3PesoMinimo: number }>()
  for (const c of cargasRelevantes) {
    const chave = `${c.subTipoProdutoPrincipal}|${c.tabelaPreco}`
    const e = porSubTipoProdutoTabela.get(chave) ?? {
      subTipoProduto: c.subTipoProdutoPrincipal,
      tabelaPreco: c.tabelaPreco,
      n: 0,
      m3Total: 0,
      faturamento: 0,
      m3PesoMinimo: 0,
    }
    e.n++
    e.m3Total += c.m3Total
    e.faturamento += c.faturamentoBruto
    e.m3PesoMinimo += (c.precoPonderado ?? 0) * c.m3Total
    porSubTipoProdutoTabela.set(chave, e)
  }
  const resumoPorTipoTabela = [...porSubTipoProdutoTabela.values()]
    .map((e) => ({
      subTipoProduto: e.subTipoProduto,
      tabelaPreco: e.tabelaPreco,
      n: e.n,
      m3Total: e.m3Total,
      valorM3Medio: e.m3Total > 0 ? e.faturamento / e.m3Total : null,
      precoPonderado: e.m3Total > 0 ? e.m3PesoMinimo / e.m3Total : null,
    }))
    .sort((a, b) => (b.valorM3Medio ?? 0) - (a.valorM3Medio ?? 0))

  const melhoresCargas = [...cargasRelevantes].sort((a, b) => (b.valorM3! - (b.precoPonderado ?? 0)) - (a.valorM3! - (a.precoPonderado ?? 0))).slice(0, 20)
  const pioresCargas = [...cargasRelevantes].sort((a, b) => (a.valorM3! - (a.precoPonderado ?? 0)) - (b.valorM3! - (b.precoPonderado ?? 0))).slice(0, 20)

  // Direcionamento por cliente — RESPOSTA do usuário 2026-08-04: "a análise
  // precisa ser feita em cargas reais já feitas anteriormente por clientes,
  // preciso de um direcionamento para o cliente quando tiver dúvida". Para
  // cada cliente, a MELHOR carga real que ele já comprou vira a referência
  // ("quando esse cliente ficar em dúvida do que comprar, aponte esta carga
  // como o padrão a repetir").
  const porCliente = new Map<string, (typeof cargasRelevantes)[number][]>()
  for (const c of cargasRelevantes) {
    const lista = porCliente.get(c.cliente || '—') ?? []
    lista.push(c)
    porCliente.set(c.cliente || '—', lista)
  }
  const direcionamentoPorCliente = [...porCliente.entries()]
    .map(([cliente, lista]) => {
      const melhor = [...lista].sort((a, b) => (b.valorM3! - (b.precoPonderado ?? 0)) - (a.valorM3! - (a.precoPonderado ?? 0)))[0]
      return { cliente, numCargas: lista.length, melhorCarga: melhor }
    })
    .sort((a, b) => (b.melhorCarga.valorM3! - (b.melhorCarga.precoPonderado ?? 0)) - (a.melhorCarga.valorM3! - (a.melhorCarga.precoPonderado ?? 0)))

  return NextResponse.json({
    period: { from, to },
    totalCargas: cargas.length,
    // BUG corrigido 2026-08-04: usava `numLinhas` (nº de itens/produtos da
    // NF, quase sempre >1) em vez de `notas.length` (nº de NFs distintas de
    // fato) — uma carga com 1 NF e 10 produtos diferentes contava como
    // "carga com múltiplas notas" por engano.
    cargasComMultiplasNotas: cargas.filter((c) => c.notas.length > 1).length,
    linhasSemPlaca,
    m3MinimoCarga: M3_MINIMO_CARGA,
    resumoPorTipoTabela,
    melhoresCargas,
    pioresCargas,
    direcionamentoPorCliente,
  })
}
