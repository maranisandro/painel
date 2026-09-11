import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, hasModuleAccess } from '@/lib/authz'
import { prisma } from '@/lib/prisma'

const STATUS_VALIDOS = ['FAZER_CONTATO', 'NEGATIVADO', 'SEM_INTERESSE', 'ENCERROU_ATIVIDADE']

/**
 * Fase 3 — status de ação comercial por cliente (aba Clientes potenciais).
 * Pedido do usuário 2026-08-05: "colocar uma opção para selecionar (fazer
 * contato, cliente negativado, não tem interesse, encerrou atividade)".
 */
export async function GET() {
  const user = await getSessionUser()
  if (!hasModuleAccess(user, 'fase3')) return NextResponse.json({ error: 'acesso negado' }, { status: 403 })

  // Usuário restrito por cliente/distribuidor (escopoVendas != null) só pode
  // ver os registros dos clientes do próprio escopo — sem isso, esta rota
  // deixava enumerar nome de cliente + observação comercial fora do escopo.
  // Achado da revisão final de código (2026-09-11). Um usuário restrito só
  // por distribuidor (clientes: []) simplesmente não vê nenhum registro aqui
  // — esta rota só entende cliente, então é o comportamento conservador
  // aceito (nada de cruzar distribuidor com dado de venda para inferir).
  const registros = await prisma.fase3ClienteAcao.findMany(
    user!.escopoVendas != null ? { where: { cliente: { in: user!.escopoVendas.clientes } } } : undefined,
  )
  return NextResponse.json({ registros })
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!hasModuleAccess(user, 'fase3')) return NextResponse.json({ error: 'acesso negado' }, { status: 403 })

  const body = await req.json()
  const cliente = String(body.cliente ?? '').trim()
  const status = String(body.status ?? '').trim()
  if (!cliente) return NextResponse.json({ error: 'cliente obrigatório' }, { status: 400 })
  if (status && !STATUS_VALIDOS.includes(status)) return NextResponse.json({ error: 'status inválido' }, { status: 400 })
  if (user!.escopoVendas != null && !user!.escopoVendas.clientes.includes(cliente)) {
    return NextResponse.json({ error: 'cliente fora do escopo do usuário' }, { status: 403 })
  }

  if (!status) {
    // status vazio = remover a marcação (voltar ao estado neutro)
    await prisma.fase3ClienteAcao.deleteMany({ where: { cliente } })
    return NextResponse.json({ ok: true })
  }

  const registro = await prisma.fase3ClienteAcao.upsert({
    where: { cliente },
    update: { status, observacao: body.observacao ?? null, atualizadoPor: user?.email ?? null },
    create: { cliente, status, observacao: body.observacao ?? null, atualizadoPor: user?.email ?? null },
  })
  return NextResponse.json({ registro })
}
