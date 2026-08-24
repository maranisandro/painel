import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, hasModuleAccess } from '@/lib/authz'
import { getDatasetView } from '@/lib/semantic/dataset-view'
import { prepararVendas, agregarVendas, analisarClientes } from '@/lib/fase3/faturamento'
import { resolverConfigVendas } from '@/lib/fase3/cotas'
import { prisma } from '@/lib/prisma'

/**
 * Fase 3 — Clientes potenciais (prospecção/win-back): pedido do usuário
 * 2026-08-04 ("crie uma nova aba com clientes que eram compradores e
 * deixaram de comprar do início do negócio para cá. Trazer por nível de
 * relevância no período que comprou. Objetivo de busca de clientes
 * potenciais"). Usa TODO o histórico (desde 2022, corte da consulta
 * principal) e o critério amplo `inativo` (6+ meses sem comprar,
 * independente de ser "recorrente") — mais abrangente que a aba Clientes
 * (que só olha recorrentes parados/em queda). Cruza com o cadastro
 * `fase3_clientes` (colado pelo usuário na nota) para trazer contato
 * (e-mail/telefone) e o distribuidor cadastral, útil tanto para a
 * prospecção em si quanto para conferir se o distribuidor bate com o que a
 * consulta de vendas já calcula.
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser()
  if (!hasModuleAccess(user, 'fase3')) return NextResponse.json({ error: 'acesso negado' }, { status: 403 })

  const categoriasParam = req.nextUrl.searchParams.get('categorias')
  const categoriasSelecionadas = categoriasParam ? categoriasParam.split(',').filter(Boolean) : null
  const mesReferenciaParam = req.nextUrl.searchParams.get('mesReferencia')
  const hoje = new Date()
  const mesReferencia =
    mesReferenciaParam && /^\d{4}-\d{2}$/.test(mesReferenciaParam)
      ? mesReferenciaParam
      : `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`

  const config = await resolverConfigVendas()
  let linhasTodas: ReturnType<typeof prepararVendas> = []
  try {
    const view = await getDatasetView('fase3_vendas_madeira_tratada')
    linhasTodas = prepararVendas(view, '2000-01-01', '2999-12-31', config)
  } catch {
    linhasTodas = []
  }

  const categoriasDisponiveis = [...new Set(linhasTodas.map((l) => l.tipoProduto))].sort()
  const porCategoria = agregarVendas(linhasTodas, (l) => l.tipoProduto)
  const linhas = categoriasSelecionadas ? linhasTodas.filter((l) => categoriasSelecionadas.includes(l.tipoProduto)) : linhasTodas

  const clientes = analisarClientes(linhas, mesReferencia)
  const inativos = clientes.filter((c) => c.inativo).sort((a, b) => b.faturamentoTotal - a.faturamentoTotal)

  let contatoPorCliente = new Map<string, { distribuidor: string; email: string; telefone: string; celular: string; cidade: string; codetd: string }>()
  try {
    const clientesView = await getDatasetView('fase3_clientes')
    contatoPorCliente = new Map(
      clientesView.map((r) => [
        String(r.CLIENTE ?? '').trim(),
        {
          distribuidor: String(r.ABREV_DISTRIBUIDOR ?? 'SEM DISTRIBUIDOR'),
          email: String(r.EMAIL ?? '').trim(),
          telefone: String(r.TELEFONE ?? '').trim(),
          celular: String(r.CELULAR ?? '').trim(),
          cidade: String(r.CIDADE ?? '').trim(),
          codetd: String(r.CODETD ?? '').trim(),
        },
      ]),
    )
  } catch {
    contatoPorCliente = new Map()
  }

  const acoes = await prisma.fase3ClienteAcao.findMany()
  const acaoPorCliente = new Map(acoes.map((a) => [a.cliente, a]))

  const inativosComContato = inativos.map((c) => {
    const contato = contatoPorCliente.get(c.cliente)
    const acao = acaoPorCliente.get(c.cliente)
    return {
      ...c,
      distribuidor: contato?.distribuidor ?? 'SEM DISTRIBUIDOR',
      email: contato?.email || '—',
      telefone: contato?.telefone || contato?.celular || '—',
      cidade: contato?.cidade || '—',
      codetd: contato?.codetd || '—',
      status: acao?.status ?? null,
      observacao: acao?.observacao ?? null,
    }
  })

  return NextResponse.json({
    mesReferencia,
    categoriasDisponiveis,
    porCategoria,
    totalInativos: inativosComContato.length,
    faturamentoTotalEmRisco: inativosComContato.reduce((s, c) => s + c.faturamentoTotal, 0),
    clientes: inativosComContato,
  })
}
