# Módulo de Estatísticas de Uso — Design

Data: 2026-08-29
Escopo: novo módulo transversal (como `rh`/`abastecimento`, não é uma das 5
fases de negócio) que mostra quem acessa o painel, quem realmente usa
(navegação/tempo ativo, não só login), o que é mais usado, horários de uso
e quem não usa.

## Contexto e motivação

Pedido do usuário: "criar um módulo de estatísticas de uso do sistema de
painéis, com os usuários que mais acessam, que realmente usam o sistema, o
que mais está sendo usado, qual o tempo de uso ativo com navegação real,
horários de uso. Mostrar quem não usa." Esta demanda ficou parada até uma
revisão de documentação/segurança (concluída em 2026-08-28) e a correção
do gráfico "KM médio por placa" (Fase 1), ambos já entregues.

**Decisões já tomadas com o usuário:**
- Acesso: ADMIN sempre vê + concessão granular via o mecanismo já existente
  de `AdminResource`/`UserAdminAccess` (mesmo padrão das telas de Cadastro
  — Locais, Rotas, etc.), não um papel novo.
- "Tempo de uso ativo com navegação real": medido por um sinal de vida do
  navegador, enviado só enquanto a aba está visível e em foco — não é só
  contar página vista.
- "Quem não usa": sem login nos últimos **7 dias**, sempre relativo a hoje
  (não ao filtro de período da tela, mesmo padrão de "composição vigente
  hoje" já usado em outras telas do painel).
- Sem serviço de analytics de terceiro (Plausible/Umami) — servidor de
  produção é pequeno (2 vCPU/3,8GB) e essas ferramentas são pensadas pra
  tráfego anônimo, não pra identidade nomeada por usuário interno.

## Componentes do design

### 1. Modelo de dados (Prisma)

Uma tabela nova:

```prisma
enum UsageEventType {
  PAGE_VIEW
  HEARTBEAT
}

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

`User` ganha a relação inversa `usageEvents UsageEvent[]`. `module` é
derivado do `path` no servidor (ex. `/dashboard/fase1/mapa` → `fase1`,
`/dashboard` → `home`), nunca confiado do cliente.

**Retenção**: eventos com mais de 180 dias são apagados automaticamente
(ver item 4) — sem tabela de agregação separada nesta primeira versão
(YAGNI: o painel já segue o padrão de agregar em cima do dado bruto por
período, sem pré-agregação, e o volume esperado — algumas dezenas de
usuários — não justifica a complexidade extra agora).

### 2. Rastreamento no cliente

Novo componente `src/components/dashboard/UsageTracker.tsx` (`'use client'`),
montado uma vez em `src/app/dashboard/layout.tsx` (sem props — identifica o
usuário pela própria sessão no servidor, como qualquer rota de API já
faz). Comportamento:
- A cada mudança de rota (`usePathname()`), manda `PAGE_VIEW` com o path
  atual (dedup: não manda de novo se o path não mudou, evita duplicata do
  StrictMode em dev).
- A cada 30s, manda `HEARTBEAT` com o path atual, **só se**
  `document.visibilityState === 'visible'` **e** `document.hasFocus()`.
- Envio via `navigator.sendBeacon` (não bloqueia navegação, sobrevive a
  fechar a aba); fallback pra `fetch(..., { keepalive: true })` se
  `sendBeacon` não estiver disponível.

### 3. Endpoint de coleta

`POST /api/telemetry/event` — autenticado pela sessão (`getSessionUser()`,
401 se não logado); corpo `{ type: 'PAGE_VIEW' | 'HEARTBEAT', path: string }`
validado com Zod (`path` precisa começar com `/dashboard`); deriva `module`
server-side e insere 1 linha em `UsageEvent`. Resposta mínima (`204` ou
`{ ok: true }`) — endpoint chamado com frequência, precisa ser barato.

### 4. Limpeza automática

Sem crontab novo no servidor: reaproveita o `/api/cron/sync` que já roda a
cada 5 minutos em produção. No mesmo handler, um novo passo roda **só**
quando a hora atual (horário do servidor) é 3h — apaga `UsageEvent` com
`occurredAt` mais antigo que 180 dias. Idempotente (rodar de novo no mesmo
dia não causa problema, só não encontra nada pra apagar na segunda vez).

### 5. Endpoint de estatísticas

`GET /api/estatisticas-uso/data?from=&to=` (mesmo padrão de período dos
outros painéis, default mês atual). Calcula:
- **Ranking de acessos**: `AuditLog` (`action: 'LOGIN'`) agrupado por
  usuário dentro do período — contagem de logins e data do último. Sem
  rastreamento novo, dado já existe.
- **Ranking de uso real**: `UsageEvent` (`type: 'HEARTBEAT'`) agrupado por
  usuário dentro do período — nº de sinais × 30s = minutos ativos
  estimados.
- **Módulo mais usado**: `UsageEvent` (`type: 'PAGE_VIEW'`) agrupado por
  `module` dentro do período.
- **Horários de uso**: `UsageEvent` (qualquer tipo) agrupado por hora do
  dia (0–23) dentro do período — histograma.
- **Quem não usa**: todos os `User.active = true`, com o último
  `AuditLog` de `LOGIN` (todo o histórico, não limitado ao período) há
  mais de 7 dias, ou nunca logou — sempre relativo a hoje.

### 6. Tela

`/dashboard/admin/estatisticas-uso` — filtro de período (`DateRangeInputs`,
default mês atual), KPIs (usuários ativos no período, usuários inativos há
7+ dias, módulo mais usado), tabela de ranking de acessos, tabela de
ranking de uso real (minutos ativos), gráfico de módulo mais usado (barras),
histograma de horários de uso, e lista de "quem não usa" (nome + data do
último login ou "nunca").

### 7. Acesso

Novo `AdminResource` (`code: 'estatisticas-uso'`, seed em
`prisma/seed.ts`), novo card em `cardsPorRecurso` (`/dashboard/admin/page.tsx`),
mesmo padrão de `hasResourceAccess`/`canEditResource` já usado pelas
outras telas de Cadastro.

## Fora de escopo (explicitamente)

- Papel/permissão novo — reaproveita `AdminResource` existente.
- Tabela de agregação/rollup separada — se o volume crescer a ponto de
  incomodar, decidir depois com dado real.
- Serviço de analytics de terceiro.
- Qualquer mudança nos dashboards de módulo existentes (Fase 1/3/5, RH,
  Abastecimento) além do próprio `layout.tsx` (montagem do `UsageTracker`).
- Alertas/notificação automática sobre inatividade — só exibição na tela.

## Testes / validação

Sem test runner no projeto (mesma limitação já documentada nas specs
anteriores). Validação: `npx tsc --noEmit`, `npm run build`, e verificação
manual no navegador — confirmar que o `UsageTracker` manda eventos (rede
do navegador), que a tela de estatísticas mostra números reais depois de
navegar um pouco pelo painel, e que o acesso é bloqueado para um usuário
sem o `AdminResource` concedido.
