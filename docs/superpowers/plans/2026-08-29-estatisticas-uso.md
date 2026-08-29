# Módulo de Estatísticas de Uso Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Novo módulo transversal que mostra quem acessa o painel, quem realmente usa (tempo ativo com navegação real), o que é mais usado, horários de uso e quem não usa.

**Architecture:** Uma tabela nova (`UsageEvent`) alimentada por um rastreador leve no cliente (`sendBeacon`, só com aba visível/em foco) e um endpoint de coleta; reaproveita o `AuditLog` de login já existente para ranking de acessos e inatividade; acesso pelo mecanismo `AdminResource` já usado nas telas de Cadastro; limpeza automática piggyback no cron de sincronização que já roda a cada 5 min.

**Tech Stack:** Next.js 16 (App Router), Prisma 7 + adapter-pg, Zod, Recharts (já dependências do projeto). Sem dependência nova.

**Spec:** `docs/superpowers/specs/2026-08-29-estatisticas-uso-design.md`

## Global Constraints

- Sem nova dependência.
- Acesso via `AdminResource`/`requireResourceViewer`/`hasResourceAccess` — mesmo mecanismo das telas de Cadastro, sem papel novo.
- "Quem não usa" = sem `AuditLog` de `LOGIN` há mais de 7 dias (ou nunca), sempre relativo a **hoje** (`new Date()`), nunca ao filtro `from`/`to` da tela.
- `module` do `UsageEvent` é derivado do `path` **no servidor**, nunca aceito do cliente como valor livre.
- Retenção: `UsageEvent` com mais de 180 dias é apagado automaticamente, piggyback no `/api/cron/sync` já existente (roda a cada 5 min em produção) — quando a hora do servidor for 3h. Sem crontab novo.
- Este projeto não tem test runner configurado. Verificação de cada task usa `npx tsc --noEmit` e, quando a task altera algo visível/testável no navegador, uma checagem manual explícita — nunca "adicionar teste depois".
- Fora de escopo: papel/permissão novo, tabela de agregação/rollup separada, serviço de analytics de terceiro, qualquer mudança nos dashboards de módulo existentes (Fase 1/3/5, RH, Abastecimento) além do `layout.tsx` (só a montagem do rastreador).

---

### Task 1: Schema, migration e seed do AdminResource

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `prisma/seed.ts`

**Interfaces:**
- Produces: modelo Prisma `UsageEvent` (`id`, `userId`, `type: UsageEventType`, `path`, `module`, `occurredAt`), enum `UsageEventType { PAGE_VIEW, HEARTBEAT }`, relação `User.usageEvents`. `AdminResource` com `code: 'estatisticas-uso'`. Consumido pelas tasks 2, 4, 5, 7.

- [ ] **Step 1: Adicionar o enum e o modelo em `schema.prisma`**

Abrir `prisma/schema.prisma`. Logo depois do modelo `AuditLog` (que termina em `@@map("audit_logs")` seguido de `}`), adicionar:

```prisma
enum UsageEventType {
  PAGE_VIEW
  HEARTBEAT
}

// Rastreamento de uso (pedido do usuário 2026-08-28/29) — page view a cada
// navegação, heartbeat a cada 30s só com a aba visível/em foco (ver
// src/components/dashboard/UsageTracker.tsx). `module` é derivado do path
// no servidor para agregação (ex. /dashboard/fase1/mapa -> "fase1").
model UsageEvent {
  id         String         @id @default(uuid())
  userId     String         @map("user_id")
  user       User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  type       UsageEventType
  path       String
  module     String
  occurredAt DateTime       @default(now()) @map("occurred_at")

  @@index([userId, occurredAt])
  @@index([module, occurredAt])
  @@map("usage_events")
}
```

- [ ] **Step 2: Adicionar a relação inversa no modelo `User`**

No modelo `User`, a linha `adminAccesses      UserAdminAccess[]` é seguida de uma linha em branco e `@@map("users")`. Adicionar `usageEvents        UsageEvent[]` logo depois de `adminAccesses`:

```prisma
  adminAccesses      UserAdminAccess[]
  usageEvents        UsageEvent[]
```

- [ ] **Step 3: Gerar e aplicar a migration**

Run: `npx prisma migrate dev --name usage_event`
Expected: migration criada em `prisma/migrations/<timestamp>_usage_event/`, aplicada sem erro no Postgres de dev (`plantar_postgres`, banco `paineis_db`). Confirmar que o SQL gerado é só `CREATE TYPE`/`CREATE TABLE`/`ALTER TABLE ... ADD COLUMN` (aditivo, sem `DROP`).

- [ ] **Step 4: Adicionar o `AdminResource` no seed**

Em `prisma/seed.ts`, encontrar o array `adminResources` (lista de `{ code, name, position }`) e adicionar uma entrada com a próxima posição livre, por exemplo:

```ts
{ code: 'estatisticas-uso', name: 'Estatísticas de Uso', position: 10 },
```

(Ajustar `position` para o próximo número livre da lista real — conferir o array antes de escolher o valor exato, não adivinhar.)

- [ ] **Step 5: Rodar o seed**

Run: `npx tsx prisma/seed.ts`
Expected: roda sem erro; idempotente (`upsert` por `code`) — pode rodar de novo sem duplicar nem sobrescrever dado que o usuário já cadastrou.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros (o `PrismaClient` gerado já inclui os novos tipos `UsageEvent`/`UsageEventType` desde o Step 3).

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/seed.ts prisma/migrations
git commit -m "feat: schema do UsageEvent + AdminResource estatisticas-uso"
```

---

### Task 2: Endpoint de coleta

**Files:**
- Create: `src/app/api/telemetry/event/route.ts`

**Interfaces:**
- Consumes: `getSessionUser` (`@/lib/authz`), `prisma.usageEvent` (Task 1).
- Produces: `POST /api/telemetry/event` — corpo `{ type: 'PAGE_VIEW' | 'HEARTBEAT', path: string }`, `204` em sucesso, `401` sem sessão, `400` corpo inválido. Consumido pela Task 3.

- [ ] **Step 1: Criar o endpoint**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSessionUser } from '@/lib/authz'
import { prisma } from '@/lib/prisma'

const eventSchema = z.object({
  type: z.enum(['PAGE_VIEW', 'HEARTBEAT']),
  path: z.string().startsWith('/dashboard'),
})

/** Deriva o "módulo" do path para agregação (ex. /dashboard/fase1/mapa -> "fase1", /dashboard -> "home"). */
function moduleFromPath(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts[1] ?? 'home'
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'não autorizado' }, { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'corpo inválido' }, { status: 400 })
  }
  const parsed = eventSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join('; ') }, { status: 400 })
  }

  await prisma.usageEvent.create({
    data: {
      userId: user.id,
      type: parsed.data.type,
      path: parsed.data.path,
      module: moduleFromPath(parsed.data.path),
    },
  })

  return new NextResponse(null, { status: 204 })
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Verificação manual**

Com `npm run dev` rodando e logado no painel (qualquer usuário), abrir o DevTools do navegador (aba Network) e rodar no console:
```js
fetch('/api/telemetry/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'PAGE_VIEW', path: '/dashboard' }) }).then(r => console.log(r.status))
```
Expected: `204` no console. Confirmar (via `npx prisma studio` ou uma query rápida) que uma linha nova apareceu em `usage_events` com `module = 'home'`.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/telemetry/event/route.ts
git commit -m "feat: endpoint de coleta de eventos de uso"
```

---

### Task 3: Rastreador no cliente

**Files:**
- Create: `src/components/dashboard/UsageTracker.tsx`
- Modify: `src/app/dashboard/layout.tsx`

**Interfaces:**
- Consumes: `POST /api/telemetry/event` (Task 2).
- Produces: componente `UsageTracker` (sem props, sem renderização visível), montado uma vez no shell do dashboard.

- [ ] **Step 1: Criar o rastreador**

```tsx
'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'

const HEARTBEAT_INTERVAL_MS = 30_000

function sendEvent(type: 'PAGE_VIEW' | 'HEARTBEAT', path: string) {
  const body = JSON.stringify({ type, path })
  if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
    const ok = navigator.sendBeacon('/api/telemetry/event', new Blob([body], { type: 'application/json' }))
    if (ok) return
  }
  fetch('/api/telemetry/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {})
}

/**
 * Rastreamento de uso (pedido do usuário 2026-08-28/29) — manda PAGE_VIEW a
 * cada navegação e HEARTBEAT a cada 30s só enquanto a aba está visível e em
 * foco, para medir "tempo de uso ativo com navegação real" (não abas
 * abertas em segundo plano). Sem UI própria.
 */
export function UsageTracker() {
  const pathname = usePathname()
  const lastPathRef = useRef<string | null>(null)

  useEffect(() => {
    if (!pathname || lastPathRef.current === pathname) return
    lastPathRef.current = pathname
    sendEvent('PAGE_VIEW', pathname)
  }, [pathname])

  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible' && document.hasFocus() && lastPathRef.current) {
        sendEvent('HEARTBEAT', lastPathRef.current)
      }
    }, HEARTBEAT_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [])

  return null
}
```

- [ ] **Step 2: Montar no layout do dashboard**

Em `src/app/dashboard/layout.tsx`, adicionar o import:

```ts
import { UsageTracker } from '@/components/dashboard/UsageTracker'
```

E renderizar `<UsageTracker />` como filho direto do `<div className="flex h-dvh flex-col">` (antes do `<header>`, já que não renderiza nada visível — a posição exata no JSX não importa):

```tsx
    <div className="flex h-dvh flex-col">
      <UsageTracker />
      <header className="shrink-0 border-b border-neutral-200 bg-white print:hidden">
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Verificação manual**

Com `npm run dev` rodando, logar no painel, abrir o DevTools (aba Network, filtro `telemetry`) e navegar entre 2-3 telas. Confirmar: uma chamada a `/api/telemetry/event` por navegação (`type: PAGE_VIEW`); depois de ~30s parado numa tela com a aba em foco, uma chamada `HEARTBEAT`; trocar de aba do navegador (perder o foco) por 1 minuto e confirmar que NENHUM `HEARTBEAT` novo aparece enquanto a aba não está em foco.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/UsageTracker.tsx src/app/dashboard/layout.tsx
git commit -m "feat: rastreador de uso (page view + heartbeat) no shell do dashboard"
```

---

### Task 4: Limpeza automática de eventos antigos

**Files:**
- Create: `src/lib/usage/cleanup.ts`
- Modify: `src/app/api/cron/sync/route.ts`

**Interfaces:**
- Produces: `limparUsageEventsAntigos(): Promise<number>`.

- [ ] **Step 1: Criar a função de limpeza**

```ts
import { prisma } from '@/lib/prisma'

const RETENTION_DAYS = 180

/**
 * Apaga UsageEvent mais antigos que RETENTION_DAYS — chamado só quando a
 * hora atual é 3h (ver src/app/api/cron/sync/route.ts), pra rodar uma vez
 * por dia sem precisar de um crontab novo em produção (o cron de sync já
 * roda a cada 5 min).
 */
export async function limparUsageEventsAntigos(): Promise<number> {
  const corte = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000)
  const { count } = await prisma.usageEvent.deleteMany({ where: { occurredAt: { lt: corte } } })
  return count
}
```

- [ ] **Step 2: Chamar a partir do cron de sync**

Ler `src/app/api/cron/sync/route.ts` (arquivo pequeno, ~15 linhas) e adicionar a chamada. O resultado deve ficar equivalente a:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { runDueSchedules } from '@/lib/sync/engine'
import { limparUsageEventsAntigos } from '@/lib/usage/cleanup'

/**
 * Endpoint chamado pelo Agendador de Tarefas do Windows (ou outro cron):
 *   curl -H "x-cron-secret: $CRON_SECRET" http://localhost:3002/api/cron/sync
 * Executa todas as agendas de sincronização vencidas.
 */
export async function GET(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret')
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'não autorizado' }, { status: 401 })
  }
  const results = await runDueSchedules()

  // Limpeza de eventos de uso antigos (S da retenção do módulo de
  // estatísticas) — só 1x/dia, piggyback neste mesmo cron de 5 em 5 min,
  // sem precisar de um crontab novo em produção.
  let usageEventsApagados: number | null = null
  if (new Date().getHours() === 3) {
    usageEventsApagados = await limparUsageEventsAntigos()
  }

  return NextResponse.json({ ran: results.length, results, usageEventsApagados })
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Verificação manual**

Não dá pra esperar até 3h da manhã pra testar de verdade — verificar chamando a função diretamente. Com `npm run dev` rodando, criar um script descartável `tmp-test-cleanup.mjs` na raiz do projeto:
```js
import 'dotenv/config'
import { limparUsageEventsAntigos } from './src/lib/usage/cleanup.ts'
const n = await limparUsageEventsAntigos()
console.log('apagados:', n)
```
Rodar `npx tsx tmp-test-cleanup.mjs`, confirmar que executa sem erro (deve devolver `0` se não houver eventos com mais de 180 dias, o que é o esperado nesta fase do projeto). Apagar o script descartável depois (`rm tmp-test-cleanup.mjs`) — não deve ir para o commit.

- [ ] **Step 5: Commit**

```bash
git add src/lib/usage/cleanup.ts src/app/api/cron/sync/route.ts
git commit -m "feat: limpeza automatica de eventos de uso com mais de 180 dias"
```

---

### Task 5: Endpoint de estatísticas agregadas

**Files:**
- Create: `src/app/api/estatisticas-uso/data/route.ts`

**Interfaces:**
- Consumes: `requireResourceViewer` (`@/lib/api-helpers`), `prisma.usageEvent`/`prisma.auditLog`/`prisma.user`.
- Produces: `GET /api/estatisticas-uso/data?from=&to=` devolvendo `{ period, rankingAcessos, rankingUsoReal, moduloMaisUsado, horarios, quemNaoUsa }`. Consumido pela Task 6.

- [ ] **Step 1: Criar o endpoint**

```ts
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

  const [usuariosAtivos, loginsNoPeriodo, heartbeatsNoPeriodo, pageViewsNoPeriodo, ultimoLoginPorUsuario, eventosDoPeriodo] =
    await Promise.all([
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
  const quemNaoUsa = usuariosAtivos
    .map((u) => ({
      userId: u.id,
      nome: u.name,
      email: u.email,
      ultimoLogin: ultimoLoginMap.get(u.id) ?? null,
    }))
    .filter((u) => !u.ultimoLogin || u.ultimoLogin.getTime() < corteInatividade)
    .sort((a, b) => (a.ultimoLogin?.getTime() ?? 0) - (b.ultimoLogin?.getTime() ?? 0))

  return NextResponse.json({
    period: { from, to },
    rankingAcessos,
    rankingUsoReal,
    moduloMaisUsado,
    horarios,
    quemNaoUsa,
  })
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros. Se o TypeScript reclamar do formato de `_count`/`_max` do `groupBy`, conferir a assinatura exata gerada pelo Prisma Client para `UsageEvent`/`AuditLog` (rodar `npx prisma generate` se necessário) antes de alterar a lógica.

- [ ] **Step 3: Verificação manual**

Com `npm run dev` rodando e logado como ADMIN, abrir no navegador (ou via `curl` com o cookie de sessão) `http://localhost:3002/api/estatisticas-uso/data?from=2026-08-01&to=2026-08-29` — confirmar `200` e um JSON com as 5 chaves (`rankingAcessos`, `rankingUsoReal`, `moduloMaisUsado`, `horarios`, `quemNaoUsa`), com pelo menos `rankingAcessos` não-vazio (todo usuário logado gera uma entrada de `LOGIN` no `AuditLog`).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/estatisticas-uso/data/route.ts
git commit -m "feat: endpoint de estatisticas de uso agregadas"
```

---

### Task 6: Tela do módulo

**Files:**
- Create: `src/components/estatisticas-uso/EstatisticasUsoDashboard.tsx`
- Create: `src/app/dashboard/admin/estatisticas-uso/page.tsx`

**Interfaces:**
- Consumes: `GET /api/estatisticas-uso/data` (Task 5); `Card`, `SectionHeading`, `StatTile`, `Badge`, `Callout` (`@/components/shared/ui/*`, já existentes do sub-projeto do shell); `DateRangeInputs` (`@/components/shared/DateRangeInputs`, já existente).

- [ ] **Step 1: Criar o componente da tela**

```tsx
'use client'

import { useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { DateRangeInputs } from '@/components/shared/DateRangeInputs'
import { Card } from '@/components/shared/ui/Card'
import { SectionHeading } from '@/components/shared/ui/SectionHeading'
import { StatTile } from '@/components/shared/ui/StatTile'
import { Badge } from '@/components/shared/ui/Badge'
import { Callout } from '@/components/shared/ui/Callout'

interface RankingAcesso {
  userId: string
  nome: string
  logins: number
}
interface RankingUso {
  userId: string
  nome: string
  minutosAtivos: number
}
interface ModuloUso {
  module: string
  visualizacoes: number
}
interface QuemNaoUsa {
  userId: string
  nome: string
  email: string
  ultimoLogin: string | null
}
interface ApiData {
  period: { from: string; to: string }
  rankingAcessos: RankingAcesso[]
  rankingUsoReal: RankingUso[]
  moduloMaisUsado: ModuloUso[]
  horarios: number[]
  quemNaoUsa: QuemNaoUsa[]
}

function monthStart(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}
function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export function EstatisticasUsoDashboard() {
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(todayIso())
  const [data, setData] = useState<ApiData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/estatisticas-uso/data?from=${from}&to=${to}`)
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false))
  }, [from, to])

  if (loading && !data) return <p className="text-sm text-neutral-500">Carregando dados…</p>
  if (!data) return null

  const horariosData = data.horarios.map((qtd, hora) => ({ hora: `${String(hora).padStart(2, '0')}h`, qtd }))

  return (
    <div className="space-y-8">
      <DateRangeInputs from={from} to={to} onFromChange={setFrom} onToChange={setTo} />

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <StatTile label="Usuários com login no período" value={data.rankingAcessos.length} />
        </Card>
        <Card className="p-4">
          <StatTile label="Não usam há 7+ dias" value={data.quemNaoUsa.length} />
        </Card>
        <Card className="p-4">
          <StatTile
            label="Módulo mais usado"
            value={data.moduloMaisUsado[0]?.module ?? '—'}
            hint={data.moduloMaisUsado[0] ? `${data.moduloMaisUsado[0].visualizacoes} visualizações` : undefined}
          />
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <SectionHeading className="text-base">Quem mais acessa</SectionHeading>
          <ul className="mt-3 space-y-1.5 text-sm">
            {data.rankingAcessos.slice(0, 10).map((r) => (
              <li key={r.userId} className="flex items-center justify-between">
                <span>{r.nome}</span>
                <Badge tone="brand">
                  {r.logins} login{r.logins === 1 ? '' : 's'}
                </Badge>
              </li>
            ))}
            {data.rankingAcessos.length === 0 && <p className="text-neutral-500">Nenhum login no período.</p>}
          </ul>
        </Card>
        <Card className="p-4">
          <SectionHeading className="text-base">Quem realmente usa (tempo ativo)</SectionHeading>
          <ul className="mt-3 space-y-1.5 text-sm">
            {data.rankingUsoReal.slice(0, 10).map((r) => (
              <li key={r.userId} className="flex items-center justify-between">
                <span>{r.nome}</span>
                <Badge tone="brand">{r.minutosAtivos} min</Badge>
              </li>
            ))}
            {data.rankingUsoReal.length === 0 && <p className="text-neutral-500">Sem dados de navegação ainda.</p>}
          </ul>
        </Card>
      </section>

      <Card className="p-4">
        <SectionHeading className="text-base">Módulo mais usado</SectionHeading>
        <div className="mt-3 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.moduloMaisUsado}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="module" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="visualizacoes" fill="#059669" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card className="p-4">
        <SectionHeading className="text-base">Horários de uso</SectionHeading>
        <div className="mt-3 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={horariosData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="hora" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="qtd" fill="#059669" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Callout tone="warning" title="Quem não usa (sem login há 7+ dias)">
        <ul className="mt-2 space-y-1">
          {data.quemNaoUsa.map((u) => (
            <li key={u.userId}>
              {u.nome} ({u.email}) —{' '}
              {u.ultimoLogin ? `último login ${new Date(u.ultimoLogin).toLocaleDateString('pt-BR')}` : 'nunca logou'}
            </li>
          ))}
          {data.quemNaoUsa.length === 0 && <li>Todos os usuários ativos acessaram nos últimos 7 dias.</li>}
        </ul>
      </Callout>
    </div>
  )
}
```

- [ ] **Step 2: Criar a página**

```tsx
import { EstatisticasUsoDashboard } from '@/components/estatisticas-uso/EstatisticasUsoDashboard'

export default function EstatisticasUsoPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Estatísticas de Uso</h1>
      <EstatisticasUsoDashboard />
    </div>
  )
}
```

Nota: seguindo o mesmo padrão já usado em `/dashboard/admin/locais` e demais telas de Cadastro, a página não tem guarda de acesso própria no servidor — o controle é feito pelo endpoint (`requireResourceViewer` na Task 5) e pelo card em `/dashboard/admin` só aparecer para quem tem acesso (Task 7).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Verificação manual**

Com `npm run dev` rodando e logado como ADMIN, abrir `http://localhost:3002/dashboard/admin/estatisticas-uso`: confirmar que a tela carrega sem erro no console, mostra os 3 KPIs, as duas tabelas de ranking (mesmo que vazias/com poucos dados nesta fase inicial), os dois gráficos de barra (renderizando, mesmo vazios) e a lista de "quem não usa". Trocar o período no `DateRangeInputs` e confirmar que os dados recarregam.

- [ ] **Step 5: Commit**

```bash
git add src/components/estatisticas-uso/EstatisticasUsoDashboard.tsx src/app/dashboard/admin/estatisticas-uso/page.tsx
git commit -m "feat: tela do modulo de estatisticas de uso"
```

---

### Task 7: Card na tela de Cadastros

**Files:**
- Modify: `src/app/dashboard/admin/page.tsx`

**Interfaces:**
- Consumes: `AdminResource` `estatisticas-uso` (Task 1), rota `/dashboard/admin/estatisticas-uso` (Task 6).

- [ ] **Step 1: Adicionar a contagem à consulta**

Em `src/app/dashboard/admin/page.tsx`, adicionar `prisma.usageEvent.count()` ao array do `Promise.all` que já busca `locais`, `rotas`, etc., e adicionar `usageEventos` à lista de variáveis desestruturadas correspondente (mesmo padrão dos outros contadores — ler o arquivo para pegar a ordem exata das variáveis antes de editar, não adivinhar a posição).

- [ ] **Step 2: Adicionar o card**

No array `cardsPorRecurso` (antes do `].filter((c) => hasResourceAccess(user, c.resource))`), adicionar:

```ts
{
  resource: 'estatisticas-uso',
  href: '/dashboard/admin/estatisticas-uso',
  title: 'Estatísticas de Uso',
  count: usageEventos,
  desc: 'Quem acessa, quem realmente usa, o que é mais usado e quem não usa o painel.',
},
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Verificação manual**

Com `npm run dev` rodando, logar como ADMIN e abrir `/dashboard/admin`: confirmar que o card "Estatísticas de Uso" aparece na grade, com o link levando para a tela da Task 6. Logar com um usuário sem o `AdminResource` `estatisticas-uso` concedido (ou um usuário só com outros recursos) e confirmar que o card **não** aparece.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/admin/page.tsx
git commit -m "feat: card de Estatisticas de Uso na tela de Cadastros"
```

---

## Self-Review

**Cobertura da spec:**
- Modelo de dados (`UsageEvent`) → Task 1.
- Rastreamento no cliente (page view + heartbeat visível/em foco) → Task 3.
- Endpoint de coleta → Task 2.
- Limpeza automática (180 dias, piggyback no cron) → Task 4.
- Endpoint de estatísticas (5 métricas: ranking de acessos, ranking de uso real, módulo mais usado, horários, quem não usa) → Task 5.
- Tela → Task 6.
- Acesso via `AdminResource` → Tasks 1 e 7.
- Fora de escopo (papel novo, tabela de rollup, analytics de terceiro, mudança em módulos existentes) → nenhuma task toca nesses itens.

**Placeholders:** nenhum "TBD"/"similar à Task N" — todo step tem código completo, exceto os dois pontos explicitamente marcados para o implementador conferir o arquivo real antes de editar (posição no array de `AdminResource`/`Promise.all`), que são instruções deliberadas de "não adivinhar", não lacunas de especificação.

**Consistência de tipos:** o shape de `ApiData` na Task 6 bate campo a campo com o JSON devolvido pela Task 5 (`rankingAcessos`, `rankingUsoReal`, `moduloMaisUsado`, `horarios`, `quemNaoUsa`, cada um com os mesmos campos). `UsageEventType` (`'PAGE_VIEW' | 'HEARTBEAT'`) é o mesmo literal usado em `UsageTracker.tsx` (Task 3), no endpoint de coleta (Task 2) e no enum do schema (Task 1).
