import { NextRequest, NextResponse } from 'next/server'
import { requireResourceViewer } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

const INATIVIDADE_DIAS = 7

export async function GET(req: NextRequest) {
  const auth = await requireResourceViewer('estatisticas-uso')
  if ('error' in auth) return auth.error

  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  if (!from || !to) return NextResponse.json({ error: 'from/to obrigatórios' }, { status: 400 })
  const fromDate = new Date(`${from}T00:00:00`)
  const toDate = new Date(`${to}T23:59:59.999`)

  const [
    usuariosAtivos,
    loginsNoPeriodo,
    heartbeatsNoPeriodo,
    pageViewsNoPeriodo,
    ultimoLoginPorUsuario,
    eventosDoPeriodo,
    ultimaAtividadePorUsuario,
  ] = await Promise.all([
      prisma.user.findMany({ where: { active: true }, select: { id: true, name: true, email: true } }),
      prisma.auditLog.groupBy({
        by: ['userId', 'userName'],
        where: { action: 'LOGIN', createdAt: { gte: fromDate, lte: toDate } },
        _count: { _all: true },
      }),
      prisma.usageEvent.groupBy({
        by: ['userId'],
        where: { type: 'HEARTBEAT', occurredAt: { gte: fromDate, lte: toDate } },
        _count: { _all: true },
      }),
      prisma.usageEvent.groupBy({
        by: ['module'],
        where: { type: 'PAGE_VIEW', occurredAt: { gte: fromDate, lte: toDate } },
        _count: { _all: true },
      }),
      prisma.auditLog.groupBy({
        by: ['userId', 'userName'],
        where: { action: 'LOGIN' },
        _max: { createdAt: true },
      }),
      // Horários de uso (histograma por hora do dia) — agregado em memória:
      // Prisma não extrai "hora de um timestamp" de forma portável entre
      // bancos, e o volume de um período (não a vida inteira) é pequeno.
      prisma.usageEvent.findMany({
        where: { occurredAt: { gte: fromDate, lte: toDate } },
        select: { occurredAt: true },
      }),
      // Última atividade REAL (qualquer PAGE_VIEW/HEARTBEAT, todo o
      // histórico) — pedido do usuário 2026-09-11: "está falando que o
      // último login é 13/08, no entanto estou logado no sistema". Sessão
      // JWT do NextAuth dura até 30 dias (`session.strategy: 'jwt'`, sem
      // `maxAge` customizado) e o AuditLog só grava LOGIN quando a senha é
      // digitada de novo — não a cada visita. Um usuário com sessão longa
      // "nunca" gera novo LOGIN mesmo usando o sistema todo dia, então
      // `ultimoLogin` sozinho SUBESTIMA a atividade real. `ultimoAcesso`
      // abaixo usa o mais recente entre login e atividade de verdade.
      prisma.usageEvent.groupBy({ by: ['userId'], _max: { occurredAt: true } }),
    ])

  const nomeUsuario = new Map(usuariosAtivos.map((u) => [u.id, u.name] as const))

  const rankingAcessos = loginsNoPeriodo
    .map((l) => ({
      userId: l.userId ?? '',
      nome: (l.userId && nomeUsuario.get(l.userId)) || l.userName || '—',
      logins: l._count._all,
    }))
    .sort((a, b) => b.logins - a.logins)

  const rankingUsoReal = heartbeatsNoPeriodo
    .map((h) => ({
      userId: h.userId,
      nome: nomeUsuario.get(h.userId) ?? '—',
      minutosAtivos: Math.round((h._count._all * 30) / 60),
    }))
    .sort((a, b) => b.minutosAtivos - a.minutosAtivos)

  const moduloMaisUsado = pageViewsNoPeriodo
    .map((m) => ({ module: m.module, visualizacoes: m._count._all }))
    .sort((a, b) => b.visualizacoes - a.visualizacoes)

  const horarios = Array.from({ length: 24 }, () => 0)
  for (const e of eventosDoPeriodo) horarios[e.occurredAt.getHours()] += 1

  const corteInatividade = Date.now() - INATIVIDADE_DIAS * 24 * 60 * 60 * 1000
  const ultimoLoginMap = new Map(
    ultimoLoginPorUsuario
      .filter((l): l is typeof l & { userId: string } => !!l.userId)
      .map((l) => [l.userId, l._max.createdAt] as const),
  )
  const ultimaAtividadeMap = new Map(ultimaAtividadePorUsuario.map((a) => [a.userId, a._max.occurredAt] as const))
  const quemNaoUsa = usuariosAtivos
    .map((u) => {
      const ultimoLogin = ultimoLoginMap.get(u.id) ?? null
      const ultimaAtividade = ultimaAtividadeMap.get(u.id) ?? null
      const ultimoAcesso =
        ultimoLogin && ultimaAtividade
          ? (ultimoLogin.getTime() >= ultimaAtividade.getTime() ? ultimoLogin : ultimaAtividade)
          : (ultimoLogin ?? ultimaAtividade)
      return { userId: u.id, nome: u.name, email: u.email, ultimoAcesso }
    })
    .filter((u) => !u.ultimoAcesso || u.ultimoAcesso.getTime() < corteInatividade)
    .sort((a, b) => (a.ultimoAcesso?.getTime() ?? 0) - (b.ultimoAcesso?.getTime() ?? 0))

  return NextResponse.json({
    period: { from, to },
    rankingAcessos,
    rankingUsoReal,
    moduloMaisUsado,
    horarios,
    quemNaoUsa,
  })
}
