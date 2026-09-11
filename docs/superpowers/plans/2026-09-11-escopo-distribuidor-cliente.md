# Escopo de acesso por Distribuidor/Cliente + cascata de filtro — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restringir, server-side, quais distribuidores/clientes um usuário
vê em qualquer rota da Fase 3, e corrigir o combo de cliente do Painel
Estratégico/tático para listar só os clientes do distribuidor selecionado.

**Architecture:** Duas tabelas Prisma novas (`UserDistributorScope`/
`UserClientScope`) guardam o vínculo usuário→distribuidor/cliente.
`SessionUser.escopoVendas` (resolvido em `getSessionUser`) expõe esse
vínculo como `{ distribuidores: string[]; clientes: string[] } | null`
(`null` = sem restrição). Um helper único (`aplicarEscopoUsuario`) filtra as
`VendaLinha[]` por esse escopo logo após `prepararVendas`, em TODAS as
rotas da Fase 3 — antes de qualquer filtro vindo de query string, para que
a restrição não possa ser burlada pela URL. A tela de usuários ganha dois
seletores (distribuidor: checkbox, cliente: busca+multi-seleção) que
gravam nas tabelas novas pelo mesmo endpoint que já grava módulo/cadastro.

**Tech Stack:** Next.js (App Router) + Prisma + Postgres, TypeScript, React
(client components `'use client'`), Tailwind. Sem framework de teste no
projeto — verificação por `npx tsc --noEmit` e checklist de teste manual.

**Spec:** `docs/superpowers/specs/2026-09-11-escopo-distribuidor-cliente-design.md`

## Global Constraints

- Enforcement é sempre server-side, aplicado ANTES de qualquer leitura de
  `req.nextUrl.searchParams` que vire filtro — nunca confiar em parâmetro de
  URL para a restrição de segurança.
- ADMIN nunca é restringido, independente de qualquer vínculo cadastrado.
- Usuário sem nenhum vínculo nas 2 tabelas novas: sem restrição (vê tudo,
  comportamento idêntico ao atual).
- Quando o usuário tem distribuidor(es) E cliente(s) vinculados: união (OR)
  — vê venda que bata com QUALQUER um dos vínculos.
- Chave de vínculo: `VendaLinha.distribuidor` (string, bucket
  ABREV_DISTRIBUIDOR) e `VendaLinha.cliente` (string, nome) — os MESMOS
  valores já usados nos filtros de checkbox/combo existentes, não código
  (`CODCFO`/`CODDISTRIBUIDOR`).
- Aplica-se às 8 rotas da Fase 3 que retornam `VendaLinha[]`: `estrategico`,
  `data`, `clientes`, `clientes-potenciais`, `melhor-carga`, `bonificacoes`,
  `conferencia-devolucoes`, `critica` (só o `GET`, não o `POST` de achados).

---

## File Structure

- Modify: `prisma/schema.prisma` — 2 models novos + relação inversa em `User`.
- Create: `prisma/migrations/<timestamp>_user_distributor_client_scopes/migration.sql`.
- Modify: `src/lib/authz.ts` — `SessionUser.escopoVendas` + resolução em `getSessionUser`.
- Create: `src/lib/fase3/escopo-usuario.ts` — `aplicarEscopoUsuario`.
- Modify: as 8 rotas da Fase 3 (aplicar o helper).
- Modify: `src/app/api/fase3/estrategico/route.ts` e `src/app/api/fase3/data/route.ts` — cascata `clientesDisponiveis`.
- Modify: `src/app/api/admin/users/route.ts` e `src/app/api/admin/users/[id]/route.ts` — schema/transação/auditoria + listas disponíveis.
- Modify: `src/app/dashboard/admin/usuarios/UserManagement.tsx` — checkboxes de distribuidor.
- Create: `src/app/dashboard/admin/usuarios/ClienteEscopoSelecao.tsx` — busca+multi-seleção de cliente (reaproveita a UX de `src/components/fase3/ClienteFiltro.tsx`, mas multi-select).

---

### Task 1: Schema Prisma — tabelas de escopo

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260911140000_user_distributor_client_scopes/migration.sql`

**Interfaces:**
- Produces: `model UserDistributorScope { userId: String; distribuidor: String }`, `model UserClientScope { userId: String; cliente: String }`, `User.distributorScopes: UserDistributorScope[]`, `User.clientScopes: UserClientScope[]`.

- [ ] **Step 1: Adicionar os 2 models e a relação inversa em `User`**

Em `prisma/schema.prisma`, dentro do `model User { ... }` (perto de
`moduleAccesses`/`adminAccesses`, por volta da linha 32), adicionar:

```prisma
  moduleAccesses     UserModuleAccess[]
  adminAccesses      UserAdminAccess[]
  distributorScopes  UserDistributorScope[]
  clientScopes       UserClientScope[]
```

Logo depois do `model ProductQuota { ... }` (fim do arquivo), adicionar:

```prisma
// Escopo de acesso por distribuidor/cliente (pedido do usuário 2026-09-11:
// "criado no cadastro de usuário um acesso onde eu possa filtrar para que
// possa ver um ou mais distribuidor e/ou um ou mais cliente. Não pode ser
// por filtro de URL"). Sem vínculo = sem restrição (comportamento atual
// preservado); com vínculo, aplicado server-side em TODA rota da Fase 3
// que retorna venda, ANTES de qualquer filtro vindo de query string — ver
// `aplicarEscopoUsuario` em src/lib/fase3/escopo-usuario.ts.
model UserDistributorScope {
  userId       String   @map("user_id")
  // Mesmo valor de VendaLinha.distribuidor (bucket ABREV_DISTRIBUIDOR),
  // igual ao filtro-checkbox de distribuidor já existente na Fase 3 —
  // não é CODDISTRIBUIDOR (código bruto).
  distribuidor String
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt    DateTime @default(now()) @map("created_at")

  @@id([userId, distribuidor])
  @@map("user_distributor_scopes")
}

model UserClientScope {
  userId    String   @map("user_id")
  // Mesmo valor de VendaLinha.cliente (nome), igual ao ClienteFiltro
  // (combo de busca) já existente na Fase 3 — não é CODCFO (código).
  cliente   String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now()) @map("created_at")

  @@id([userId, cliente])
  @@map("user_client_scopes")
}
```

- [ ] **Step 2: Gerar a migration**

Rodar (requer conexão com o banco de desenvolvimento configurado em `.env`/`DATABASE_URL`):

```bash
npx prisma migrate dev --name user_distributor_client_scopes
```

Se o ambiente não tiver conexão com um banco (ex. sandbox sem `DATABASE_URL`), criar manualmente
`prisma/migrations/20260911140000_user_distributor_client_scopes/migration.sql` com:

```sql
-- CreateTable
CREATE TABLE "user_distributor_scopes" (
    "user_id" TEXT NOT NULL,
    "distribuidor" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_distributor_scopes_pkey" PRIMARY KEY ("user_id","distribuidor")
);

-- CreateTable
CREATE TABLE "user_client_scopes" (
    "user_id" TEXT NOT NULL,
    "cliente" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_client_scopes_pkey" PRIMARY KEY ("user_id","cliente")
);

-- AddForeignKey
ALTER TABLE "user_distributor_scopes" ADD CONSTRAINT "user_distributor_scopes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_client_scopes" ADD CONSTRAINT "user_client_scopes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

e depois rodar `npx prisma generate` (sem `migrate dev`) para atualizar o client tipado sem tocar no banco.

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit`
Expected: sem erros novos relacionados a `UserDistributorScope`/`UserClientScope`.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: schema de escopo de acesso por distribuidor/cliente"
```

---

### Task 2: `SessionUser.escopoVendas`

**Files:**
- Modify: `src/lib/authz.ts`

**Interfaces:**
- Consumes: `prisma.user.findUnique` com `distributorScopes`/`clientScopes` (Task 1).
- Produces: `SessionUser.escopoVendas: { distribuidores: string[]; clientes: string[] } | null`.

- [ ] **Step 1: Adicionar o campo à interface `SessionUser`**

Em `src/lib/authz.ts`, dentro de `export interface SessionUser { ... }` (depois de `resourceCodes: string[]`), adicionar:

```ts
  /** Escopo de venda (distribuidor/cliente) — `null` = sem restrição (ADMIN, ou usuário sem nenhum vínculo). Ver `aplicarEscopoUsuario`. */
  escopoVendas: { distribuidores: string[]; clientes: string[] } | null
```

- [ ] **Step 2: Buscar os vínculos e resolver o campo em `getSessionUser`**

No `select` de `prisma.user.findUnique` dentro de `getSessionUser`, logo
depois de `adminAccesses: { select: { resource: { select: { code: true } } } },`, adicionar:

```ts
      distributorScopes: { select: { distribuidor: true } },
      clientScopes: { select: { cliente: true } },
```

No `return` de `getSessionUser`, logo depois de
`resourceCodes: user.adminAccesses.map((access) => access.resource.code),`, adicionar:

```ts
    escopoVendas:
      user.role === 'ADMIN' || (user.distributorScopes.length === 0 && user.clientScopes.length === 0)
        ? null
        : {
            distribuidores: user.distributorScopes.map((s) => s.distribuidor),
            clientes: user.clientScopes.map((s) => s.cliente),
          },
```

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/lib/authz.ts
git commit -m "feat: resolver escopo de venda (distribuidor/cliente) na sessão do usuário"
```

---

### Task 3: Helper `aplicarEscopoUsuario`

**Files:**
- Create: `src/lib/fase3/escopo-usuario.ts`

**Interfaces:**
- Consumes: `VendaLinha` (de `src/lib/fase3/faturamento.ts`), `SessionUser['escopoVendas']` (Task 2).
- Produces: `aplicarEscopoUsuario(linhas: VendaLinha[], escopo: SessionUser['escopoVendas']): VendaLinha[]`.

- [ ] **Step 1: Criar o arquivo**

```ts
import type { SessionUser } from '@/lib/authz'
import type { VendaLinha } from './faturamento'

/**
 * Restringe `linhas` ao escopo de distribuidor/cliente do usuário — pedido
 * do usuário 2026-09-11: "não pode ser por filtro de URL, tem que ser
 * inserido em código para evitar qualquer falha de segurança". Deve ser
 * chamado logo após `prepararVendas`, ANTES de qualquer filtro vindo de
 * query string, em toda rota da Fase 3 que retorna linha de venda.
 * `escopo` nulo (ADMIN ou usuário sem nenhum vínculo) não filtra nada — a
 * restrição é uma exceção explícita, nunca o padrão. Com vínculo, é união
 * (OR): a linha passa se bater com QUALQUER distribuidor OU QUALQUER
 * cliente vinculado.
 */
export function aplicarEscopoUsuario(linhas: VendaLinha[], escopo: SessionUser['escopoVendas']): VendaLinha[] {
  if (!escopo) return linhas
  return linhas.filter((l) => escopo.distribuidores.includes(l.distribuidor) || escopo.clientes.includes(l.cliente))
}
```

- [ ] **Step 2: Verificar**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/lib/fase3/escopo-usuario.ts
git commit -m "feat: helper de enforcement do escopo de distribuidor/cliente"
```

---

### Task 4: Aplicar o escopo nas 8 rotas da Fase 3

**Files:**
- Modify: `src/app/api/fase3/estrategico/route.ts:78`
- Modify: `src/app/api/fase3/data/route.ts:105,115`
- Modify: `src/app/api/fase3/clientes/route.ts:33`
- Modify: `src/app/api/fase3/clientes-potenciais/route.ts:39`
- Modify: `src/app/api/fase3/melhor-carga/route.ts:41`
- Modify: `src/app/api/fase3/bonificacoes/route.ts:36`
- Modify: `src/app/api/fase3/conferencia-devolucoes/route.ts:34`
- Modify: `src/app/api/fase3/critica/route.ts:49` (só o `GET`, não o `POST` de achados no fim do arquivo)

**Interfaces:**
- Consumes: `aplicarEscopoUsuario` (Task 3), `user!.escopoVendas` (`user` já existe em toda rota, resolvido por `getSessionUser()` antes do `hasModuleAccess` guard).

Todas as 8 rotas seguem um dos dois padrões abaixo. Em cada arquivo,
adicionar o import `import { aplicarEscopoUsuario } from '@/lib/fase3/escopo-usuario'` junto
aos outros imports de `@/lib/fase3/...`, e aplicar o helper no ponto exato indicado.

- [ ] **Step 1: `estrategico/route.ts` (linha 78)**

De:
```ts
  const linhasAno = prepararVendas(view, `${ano}-01-01`, `${ano}-12-31`, config)
```
Para:
```ts
  const linhasAno = aplicarEscopoUsuario(prepararVendas(view, `${ano}-01-01`, `${ano}-12-31`, config), user!.escopoVendas)
```

- [ ] **Step 2: `data/route.ts` (linhas 105 e 115)**

De:
```ts
  const linhasPeriodoTodosMovimentos = prepararVendas(view, from, toOficial, config)
```
Para:
```ts
  const linhasPeriodoTodosMovimentos = aplicarEscopoUsuario(prepararVendas(view, from, toOficial, config), user!.escopoVendas)
```

De:
```ts
  const linhasHojeTodosMovimentos = to >= hojeStr ? prepararVendas(view, hojeStr, hojeStr, config) : []
```
Para:
```ts
  const linhasHojeTodosMovimentos = to >= hojeStr ? aplicarEscopoUsuario(prepararVendas(view, hojeStr, hojeStr, config), user!.escopoVendas) : []
```

- [ ] **Step 3: `clientes/route.ts` (linha 33)**

De:
```ts
  try {
    const view = await getDatasetView('fase3_vendas_madeira_tratada')
    linhasTodas = prepararVendas(view, '2000-01-01', '2999-12-31', config)
  } catch {
    linhasTodas = []
  }
```
Para:
```ts
  try {
    const view = await getDatasetView('fase3_vendas_madeira_tratada')
    linhasTodas = aplicarEscopoUsuario(prepararVendas(view, '2000-01-01', '2999-12-31', config), user!.escopoVendas)
  } catch {
    linhasTodas = []
  }
```

- [ ] **Step 4: `clientes-potenciais/route.ts` (linha 39)**

De:
```ts
  try {
    const view = await getDatasetView('fase3_vendas_madeira_tratada')
    linhasTodas = prepararVendas(view, '2000-01-01', '2999-12-31', config)
  } catch {
    linhasTodas = []
  }
```
Para:
```ts
  try {
    const view = await getDatasetView('fase3_vendas_madeira_tratada')
    linhasTodas = aplicarEscopoUsuario(prepararVendas(view, '2000-01-01', '2999-12-31', config), user!.escopoVendas)
  } catch {
    linhasTodas = []
  }
```

- [ ] **Step 5: `melhor-carga/route.ts` (linha 41)**

De:
```ts
  try {
    const view = await getDatasetView('fase3_vendas_madeira_tratada')
    linhas = prepararVendas(view, from, to, config)
  } catch {
    linhas = []
  }
```
Para:
```ts
  try {
    const view = await getDatasetView('fase3_vendas_madeira_tratada')
    linhas = aplicarEscopoUsuario(prepararVendas(view, from, to, config), user!.escopoVendas)
  } catch {
    linhas = []
  }
```

- [ ] **Step 6: `bonificacoes/route.ts` (linha 36)**

De:
```ts
  try {
    const view = await getDatasetView('fase3_vendas_madeira_tratada')
    linhasPeriodo = prepararVendas(view, from, to, config)
  } catch {
    linhasPeriodo = []
  }
```
Para:
```ts
  try {
    const view = await getDatasetView('fase3_vendas_madeira_tratada')
    linhasPeriodo = aplicarEscopoUsuario(prepararVendas(view, from, to, config), user!.escopoVendas)
  } catch {
    linhasPeriodo = []
  }
```

- [ ] **Step 7: `conferencia-devolucoes/route.ts` (linha 34)**

De:
```ts
  try {
    const view = await getDatasetView('fase3_vendas_madeira_tratada')
    linhas = prepararVendas(view, from, to, config)
  } catch {
    linhas = []
  }
```
Para:
```ts
  try {
    const view = await getDatasetView('fase3_vendas_madeira_tratada')
    linhas = aplicarEscopoUsuario(prepararVendas(view, from, to, config), user!.escopoVendas)
  } catch {
    linhas = []
  }
```

- [ ] **Step 8: `critica/route.ts` (linha 49, dentro do `GET` — NÃO mexer no `POST` do fim do arquivo, que só grava reconhecimento de achado e não usa `prepararVendas`)**

De:
```ts
  try {
    const view = await getDatasetView('fase3_vendas_madeira_tratada')
    linhas = prepararVendas(view, from, to, config)
  } catch {
    linhas = []
  }
```
Para:
```ts
  try {
    const view = await getDatasetView('fase3_vendas_madeira_tratada')
    linhas = aplicarEscopoUsuario(prepararVendas(view, from, to, config), user!.escopoVendas)
  } catch {
    linhas = []
  }
```

- [ ] **Step 9: Verificar**

Run: `npx tsc --noEmit`
Expected: sem erros em nenhum dos 8 arquivos.

- [ ] **Step 10: Commit**

```bash
git add src/app/api/fase3
git commit -m "feat: aplicar escopo de distribuidor/cliente em todas as rotas da Fase 3"
```

---

### Task 5: Cascata distribuidor → cliente no combo

**Files:**
- Modify: `src/app/api/fase3/estrategico/route.ts:87,90,102-104`
- Modify: `src/app/api/fase3/data/route.ts:144,148,154-156`

**Interfaces:**
- Nenhuma nova — só reordena cálculos já existentes no mesmo arquivo.

- [ ] **Step 1: `estrategico/route.ts` — mover `clientesDisponiveis` para depois de `linhasDistribuidorFiltro`**

De (linhas ~84-104 hoje):
```ts
  // Lista de clientes SEMPRE sobre linhasAno (não filtrado) — mesmo
  // princípio de categoriasDisponiveis, o combo de busca mostra o universo
  // inteiro do ano, não só o que sobrou depois de outros filtros.
  const clientesDisponiveis = [...new Set(linhasAno.map((l) => l.cliente || '—'))].sort()
  // Distribuidores disponíveis SEMPRE sobre linhasAno (não filtrado) — mesmo
  // princípio de categoriasDisponiveis/marcasDisponiveis acima.
  const distribuidoresDisponiveis = [...new Set(linhasAno.map((l) => l.distribuidor))].sort()
  const porDistribuidorTodos = agregarVendas(linhasAno, (l) => l.distribuidor)

  // Um card clicável precisa sempre mostrar TODAS as suas próprias opções
  // (com a % real), mesmo quando uma delas já está selecionada — senão,
  // selecionar "ICMS 7%" faria os cards de 12%/18% desaparecerem, sem como
  // voltar. Por isso cada grupo de cards usa uma variante de `linhas` que
  // aplica os OUTROS filtros, mas não o dele próprio.
  const linhasCategoria = categoriasSelecionadas
    ? linhasAno.filter((l) => categoriasSelecionadas.includes(l.tipoProduto))
    : linhasAno
  const linhasMarca = marcasSelecionadas ? linhasCategoria.filter((l) => marcasSelecionadas.includes(l.marca)) : linhasCategoria
  const linhasDistribuidorFiltro = distribuidoresSelecionados
    ? linhasMarca.filter((l) => distribuidoresSelecionados.includes(l.distribuidor))
    : linhasMarca
  const linhasClienteFiltro = clienteSelecionado
    ? linhasDistribuidorFiltro.filter((l) => (l.cliente || '—') === clienteSelecionado)
    : linhasDistribuidorFiltro
```

Para (só `clientesDisponiveis` muda de posição e de fonte — o resto é idêntico):
```ts
  // Distribuidores disponíveis SEMPRE sobre linhasAno (não filtrado) — mesmo
  // princípio de categoriasDisponiveis/marcasDisponiveis acima.
  const distribuidoresDisponiveis = [...new Set(linhasAno.map((l) => l.distribuidor))].sort()
  const porDistribuidorTodos = agregarVendas(linhasAno, (l) => l.distribuidor)

  // Um card clicável precisa sempre mostrar TODAS as suas próprias opções
  // (com a % real), mesmo quando uma delas já está selecionada — senão,
  // selecionar "ICMS 7%" faria os cards de 12%/18% desaparecerem, sem como
  // voltar. Por isso cada grupo de cards usa uma variante de `linhas` que
  // aplica os OUTROS filtros, mas não o dele próprio.
  const linhasCategoria = categoriasSelecionadas
    ? linhasAno.filter((l) => categoriasSelecionadas.includes(l.tipoProduto))
    : linhasAno
  const linhasMarca = marcasSelecionadas ? linhasCategoria.filter((l) => marcasSelecionadas.includes(l.marca)) : linhasCategoria
  const linhasDistribuidorFiltro = distribuidoresSelecionados
    ? linhasMarca.filter((l) => distribuidoresSelecionados.includes(l.distribuidor))
    : linhasMarca
  // Lista de clientes SEMPRE sobre linhasDistribuidorFiltro (respeita o
  // distribuidor selecionado, mas não o próprio cliente) — pedido do
  // usuário 2026-09-11: "quando seleciono o distribuidor só liste os
  // clientes daquele distribuidor". Antes desta mudança usava linhasAno
  // (universo inteiro), ignorando o filtro de distribuidor.
  const clientesDisponiveis = [...new Set(linhasDistribuidorFiltro.map((l) => l.cliente || '—'))].sort()
  const linhasClienteFiltro = clienteSelecionado
    ? linhasDistribuidorFiltro.filter((l) => (l.cliente || '—') === clienteSelecionado)
    : linhasDistribuidorFiltro
```

- [ ] **Step 2: `data/route.ts` (linhas 139-159) — mesma mudança**

De:
```ts
  const categoriasDisponiveis = [...new Set(linhasPeriodo.map((l) => l.tipoProduto))].sort()
  // Lista de clientes SEMPRE sobre linhasPeriodo (não filtrado por categoria
  // nem pelo próprio cliente já selecionado) — mesmo princípio de
  // categoriasDisponiveis: o combo de busca sempre mostra o universo inteiro
  // do período, não só o que sobrou depois de outros filtros.
  const clientesDisponiveis = [...new Set(linhasPeriodo.map((l) => l.cliente || '—'))].sort()
  // Distribuidores disponíveis SEMPRE sobre linhasPeriodo (não filtrado pelo
  // próprio distribuidor) — mesmo princípio de categoriasDisponiveis/
  // marcasDisponiveis acima.
  const distribuidoresDisponiveis = [...new Set(linhasPeriodo.map((l) => l.distribuidor))].sort()
  const porDistribuidorTodos = agregarVendas(linhasPeriodo, (l) => l.distribuidor)
  const linhasCategoria = categoriasSelecionadas
    ? linhasPeriodo.filter((l) => categoriasSelecionadas.includes(l.tipoProduto))
    : linhasPeriodo
  const linhasMarca = marcasSelecionadas ? linhasCategoria.filter((l) => marcasSelecionadas.includes(l.marca)) : linhasCategoria
  const linhasDistribuidorFiltro = distribuidoresSelecionados
    ? linhasMarca.filter((l) => distribuidoresSelecionados.includes(l.distribuidor))
    : linhasMarca
  const linhasClienteFiltro = clienteSelecionado
    ? linhasDistribuidorFiltro.filter((l) => (l.cliente || '—') === clienteSelecionado)
    : linhasDistribuidorFiltro
```
Para (só `clientesDisponiveis` muda de posição e de fonte — o resto é idêntico):
```ts
  const categoriasDisponiveis = [...new Set(linhasPeriodo.map((l) => l.tipoProduto))].sort()
  // Distribuidores disponíveis SEMPRE sobre linhasPeriodo (não filtrado pelo
  // próprio distribuidor) — mesmo princípio de categoriasDisponiveis/
  // marcasDisponiveis acima.
  const distribuidoresDisponiveis = [...new Set(linhasPeriodo.map((l) => l.distribuidor))].sort()
  const porDistribuidorTodos = agregarVendas(linhasPeriodo, (l) => l.distribuidor)
  const linhasCategoria = categoriasSelecionadas
    ? linhasPeriodo.filter((l) => categoriasSelecionadas.includes(l.tipoProduto))
    : linhasPeriodo
  const linhasMarca = marcasSelecionadas ? linhasCategoria.filter((l) => marcasSelecionadas.includes(l.marca)) : linhasCategoria
  const linhasDistribuidorFiltro = distribuidoresSelecionados
    ? linhasMarca.filter((l) => distribuidoresSelecionados.includes(l.distribuidor))
    : linhasMarca
  // Lista de clientes SEMPRE sobre linhasDistribuidorFiltro (respeita o
  // distribuidor selecionado, mas não o próprio cliente) — pedido do
  // usuário 2026-09-11: "quando seleciono o distribuidor só liste os
  // clientes daquele distribuidor". Antes desta mudança usava linhasPeriodo
  // (universo inteiro), ignorando o filtro de distribuidor.
  const clientesDisponiveis = [...new Set(linhasDistribuidorFiltro.map((l) => l.cliente || '—'))].sort()
  const linhasClienteFiltro = clienteSelecionado
    ? linhasDistribuidorFiltro.filter((l) => (l.cliente || '—') === clienteSelecionado)
    : linhasDistribuidorFiltro
```

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit`
Expected: sem erros.

Teste manual: abrir o Painel Estratégico, selecionar um distribuidor no
filtro-checkbox, abrir o combo de cliente — só devem aparecer clientes
daquele distribuidor. Repetir na aba tática (Análise por período).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/fase3/estrategico/route.ts src/app/api/fase3/data/route.ts
git commit -m "fix: combo de cliente respeita o filtro de distribuidor selecionado"
```

---

### Task 6: Admin API — CRUD de escopo por usuário

**Achado ao explorar o código (importante):** `GET /api/admin/users`
(`route.ts`) NÃO é usado pela tela — `src/app/dashboard/admin/usuarios/page.tsx`
é um Server Component que consulta `prisma.user.findMany` DIRETAMENTE (sua
própria query, com seu próprio flatten de `moduleCodes`/`resourceCodes`) e
passa o resultado pra `<UserManagement>`; o `fetch` no client component só
chama `POST`/`PUT`/`reset-password`, nunca `GET`. Por isso este Task NÃO
mexe no `GET` (seria código morto) — as listas disponíveis e o flatten de
`distribuidores`/`clientes` entram em `page.tsx` (Task 7, Step 4), não aqui.

**Files:**
- Modify: `src/app/api/admin/users/route.ts` (só o `POST`, não o `GET`)
- Modify: `src/app/api/admin/users/[id]/route.ts` (o `PUT`)

**Interfaces:**
- Consumes: `prisma.userDistributorScope`, `prisma.userClientScope` (Task 1).
- Produces: `POST`/`PUT` aceitam `distribuidores: string[]` e `clientes: string[]` no corpo; `userSelect` de ambos os arquivos passa a incluir `distributorScopes`/`clientScopes` (usado na auditoria).

- [ ] **Step 1: `route.ts` — `userSelect` e `createSchema`**

Em `userSelect`, adicionar depois de `adminAccesses: { ... }`:

```ts
  distributorScopes: { select: { distribuidor: true } },
  clientScopes: { select: { cliente: true } },
```

Em `createSchema`, adicionar depois de `resourceCodes`:

```ts
  distribuidores: z.array(z.string().min(1)).default([]).transform((codes) => [...new Set(codes)]),
  clientes: z.array(z.string().min(1)).default([]).transform((codes) => [...new Set(codes)]),
```

No `POST`, resolver e gravar os 2 vínculos (mesmo padrão de `modules`/`resources`):

```ts
  const user = await prisma.user.create({
    data: {
      name: parsed.data.name,
      email: parsed.data.email,
      password,
      role: parsed.data.role,
      mustChangePassword: true,
      moduleAccesses:
        parsed.data.role !== 'ADMIN' && modules.length > 0
          ? { create: modules.map((module) => ({ moduleId: module.id })) }
          : undefined,
      adminAccesses:
        parsed.data.role !== 'ADMIN' && resources.length > 0
          ? { create: resources.map((resource) => ({ resourceId: resource.id })) }
          : undefined,
      distributorScopes:
        parsed.data.role !== 'ADMIN' && parsed.data.distribuidores.length > 0
          ? { create: parsed.data.distribuidores.map((distribuidor) => ({ distribuidor })) }
          : undefined,
      clientScopes:
        parsed.data.role !== 'ADMIN' && parsed.data.clientes.length > 0
          ? { create: parsed.data.clientes.map((cliente) => ({ cliente })) }
          : undefined,
    },
    select: userSelect,
  })
```

E no `logAudit` do `POST`, adicionar `distribuidores: user.distributorScopes.map((s) => s.distribuidor)` e `clientes: user.clientScopes.map((s) => s.cliente)` dentro de `details`.

- [ ] **Step 2: `[id]/route.ts` — mesmo tratamento no `PUT`**

Em `updateSchema`, adicionar os mesmos 2 campos de `createSchema` (Step 1).

Em `userSelect`, adicionar os mesmos 2 `select` de Step 1.

Na `existing` query (dentro do `PUT`), adicionar também:

```ts
      distributorScopes: { select: { distribuidor: true } },
      clientScopes: { select: { cliente: true } },
```

Em `before` (comparação de auditoria), adicionar:

```ts
    distribuidores: existing.distributorScopes.map((s) => s.distribuidor).sort(),
    clientes: existing.clientScopes.map((s) => s.cliente).sort(),
```

Dentro da transação, junto de `tx.userModuleAccess.deleteMany`/`tx.userAdminAccess.deleteMany`, adicionar:

```ts
      await tx.userDistributorScope.deleteMany({ where: { userId: id } })
      await tx.userClientScope.deleteMany({ where: { userId: id } })
```

E no `tx.user.update`, junto de `moduleAccesses`/`adminAccesses`:

```ts
          distributorScopes:
            parsed.data.role !== 'ADMIN' && parsed.data.distribuidores.length > 0
              ? { create: parsed.data.distribuidores.map((distribuidor) => ({ distribuidor })) }
              : undefined,
          clientScopes:
            parsed.data.role !== 'ADMIN' && parsed.data.clientes.length > 0
              ? { create: parsed.data.clientes.map((cliente) => ({ cliente })) }
              : undefined,
```

Em `after` (comparação de auditoria), adicionar:

```ts
        distribuidores: user.distributorScopes.map((s) => s.distribuidor).sort(),
        clientes: user.clientScopes.map((s) => s.cliente).sort(),
```

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/admin/users
git commit -m "feat: admin API grava e devolve o escopo de distribuidor/cliente do usuário"
```

---

### Task 7: Admin UI — seletores de distribuidor e cliente

**Files:**
- Create: `src/app/dashboard/admin/usuarios/ClienteEscopoSelecao.tsx`
- Modify: `src/app/dashboard/admin/usuarios/UserManagement.tsx`
- Modify: `src/app/dashboard/admin/usuarios/page.tsx` (busca `distributorScopes`/`clientScopes` e o dataset de clientes direto via Prisma/`getDatasetView` — a página NÃO usa a API route `GET`, ver achado no Task 6)

**Interfaces:**
- Consumes: `distribuidoresDisponiveis`/`clientesDisponiveis` e `users[].distribuidores`/`users[].clientes` (produzidos neste próprio Task, Step 4, em `page.tsx`).
- Produces: `ClienteEscopoSelecao({ disponiveis, selecionados, onChange })` — componente reutilizável de busca+multi-seleção.

- [ ] **Step 1: Criar `ClienteEscopoSelecao.tsx`**

```tsx
'use client'

import { useMemo, useState } from 'react'

/**
 * Multi-seleção de cliente por busca — pedido do usuário 2026-09-11: acesso
 * de usuário restrito a um ou mais clientes. Lista de clientes chega a
 * milhares (mesmo motivo do ClienteFiltro de venda, que é single-select);
 * aqui é busca por texto + chips do que já foi selecionado.
 */
export function ClienteEscopoSelecao({
  disponiveis,
  selecionados,
  onChange,
}: {
  disponiveis: string[]
  selecionados: string[]
  onChange: (clientes: string[]) => void
}) {
  const [query, setQuery] = useState('')

  const resultados = useMemo(() => {
    const q = query.trim().toLowerCase()
    const lista = disponiveis.filter((c) => !selecionados.includes(c) && (!q || c.toLowerCase().includes(q)))
    return lista.slice(0, 30)
  }, [query, disponiveis, selecionados])

  function adicionar(cliente: string) {
    onChange([...selecionados, cliente])
    setQuery('')
  }

  function remover(cliente: string) {
    onChange(selecionados.filter((c) => c !== cliente))
  }

  return (
    <div>
      {selecionados.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {selecionados.map((c) => (
            <span key={c} className="flex items-center gap-1 rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">
              {c}
              <button type="button" onClick={() => remover(c)} className="text-emerald-700 hover:text-emerald-950">
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar cliente para adicionar…"
        className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
      />
      {query && (
        <div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-sm">
          {resultados.length === 0 ? (
            <p className="px-3 py-2 text-xs text-slate-400">Nenhum cliente encontrado.</p>
          ) : (
            resultados.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => adicionar(c)}
                className="block w-full truncate px-3 py-1.5 text-left text-sm hover:bg-emerald-50"
              >
                {c}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: `UserManagement.tsx` — tipos e estado do formulário**

Em `ModuleOption`/`ResourceOption` etc., adicionar as props novas de listas
disponíveis na assinatura do componente:

```ts
export function UserManagement({
  users,
  modules,
  resources,
  distribuidoresDisponiveis,
  clientesDisponiveis,
  currentUserId,
}: {
  users: UserRow[]
  modules: ModuleOption[]
  resources: ResourceOption[]
  distribuidoresDisponiveis: string[]
  clientesDisponiveis: string[]
  currentUserId: string
}) {
```

Em `UserRow` e `FormState`, adicionar:

```ts
  distribuidores: string[]
  clientes: string[]
```

Em `EMPTY_FORM`, adicionar:

```ts
  distribuidores: [],
  clientes: [],
```

Em `openEdit`, dentro do `setForm({...})`, adicionar:

```ts
      distribuidores: user.distribuidores,
      clientes: user.clientes,
```

Adicionar a função (ao lado de `toggleModule`/`toggleResource`):

```ts
  function toggleDistribuidor(distribuidor: string) {
    setForm((current) => ({
      ...current,
      distribuidores: current.distribuidores.includes(distribuidor)
        ? current.distribuidores.filter((item) => item !== distribuidor)
        : [...current.distribuidores, distribuidor],
    }))
  }
```

No `body: JSON.stringify({...})` de `save`, adicionar as mesmas regras de
"vazio quando ADMIN" já usadas para módulo/cadastro:

```ts
        distribuidores: form.role === 'ADMIN' ? [] : form.distribuidores,
        clientes: form.role === 'ADMIN' ? [] : form.clientes,
```

- [ ] **Step 3: `UserManagement.tsx` — import e blocos de UI**

Adicionar o import:

```ts
import { ClienteEscopoSelecao } from './ClienteEscopoSelecao'
```

Depois do bloco `<div className="mt-5"> ... Acesso aos cadastros ... </div>` (antes de `{error && ...}`), adicionar:

```tsx
            <div className="mt-5">
              <p className="text-sm font-medium">Restringir a distribuidor(es)</p>
              <p className="text-xs text-slate-500">
                Sem nenhum selecionado, o usuário vê venda de todos os distribuidores (padrão atual). Selecionando um ou
                mais, ele só vê venda desses distribuidores (ou dos clientes marcados abaixo).
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {distribuidoresDisponiveis.map((distribuidor) => (
                  <label
                    key={distribuidor}
                    className={`flex items-center gap-2 rounded-lg border p-2 text-sm ${
                      form.role === 'ADMIN' ? 'border-slate-100 bg-slate-50 text-slate-400' : 'border-slate-200'
                    }`}
                  >
                    <input
                      type="checkbox"
                      disabled={form.role === 'ADMIN'}
                      checked={form.role === 'ADMIN' || form.distribuidores.includes(distribuidor)}
                      onChange={() => toggleDistribuidor(distribuidor)}
                    />
                    {distribuidor}
                  </label>
                ))}
              </div>
            </div>

            <div className="mt-5">
              <p className="text-sm font-medium">Restringir a cliente(s)</p>
              <p className="text-xs text-slate-500">
                Some-se ao filtro de distribuidor acima (o usuário vê venda que bata com QUALQUER um dos dois).
              </p>
              {form.role === 'ADMIN' ? (
                <p className="mt-2 text-xs text-slate-400">Administrador sempre vê todos os clientes.</p>
              ) : (
                <div className="mt-2">
                  <ClienteEscopoSelecao
                    disponiveis={clientesDisponiveis}
                    selecionados={form.clientes}
                    onChange={(clientes) => setForm({ ...form, clientes })}
                  />
                </div>
              )}
            </div>
```

- [ ] **Step 4: `page.tsx` — buscar as listas e o vínculo do usuário, repassar como props**

`page.tsx` é um Server Component que consulta `prisma.user.findMany`
diretamente (não usa a API route) — é aqui que entram as listas
disponíveis e o flatten de `distribuidores`/`clientes`.

De:
```ts
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getSessionUser, isAdmin } from '@/lib/authz'
import { UserManagement } from './UserManagement'

export const dynamic = 'force-dynamic'

export default async function UsuariosPage() {
  const currentUser = await getSessionUser()
  if (!isAdmin(currentUser)) redirect('/dashboard')

  const [users, modules, resources] = await Promise.all([
    prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        active: true,
        mustChangePassword: true,
        createdAt: true,
        moduleAccesses: {
          orderBy: { module: { phase: 'asc' } },
          select: {
            module: { select: { id: true, code: true, name: true, phase: true, active: true } },
          },
        },
        adminAccesses: {
          orderBy: { resource: { position: 'asc' } },
          select: {
            resource: { select: { id: true, code: true, name: true, position: true } },
          },
        },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.module.findMany({
      select: { id: true, code: true, name: true, phase: true, active: true },
      orderBy: { phase: 'asc' },
    }),
    prisma.adminResource.findMany({
      select: { id: true, code: true, name: true, position: true },
      orderBy: { position: 'asc' },
    }),
  ])

  return (
    <UserManagement
      currentUserId={currentUser!.id}
      modules={modules}
      resources={resources}
      users={users.map((user) => ({
        ...user,
        createdAt: user.createdAt.toISOString(),
        moduleCodes: user.moduleAccesses.map((access) => access.module.code),
        resourceCodes: user.adminAccesses.map((access) => access.resource.code),
      }))}
    />
  )
}
```
Para:
```ts
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getSessionUser, isAdmin } from '@/lib/authz'
import { getDatasetView } from '@/lib/semantic/dataset-view'
import { DISTRIBUIDORES_CONHECIDOS } from '@/lib/fase3/faturamento'
import { UserManagement } from './UserManagement'

export const dynamic = 'force-dynamic'

export default async function UsuariosPage() {
  const currentUser = await getSessionUser()
  if (!isAdmin(currentUser)) redirect('/dashboard')

  const [users, modules, resources, vendasView] = await Promise.all([
    prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        active: true,
        mustChangePassword: true,
        createdAt: true,
        moduleAccesses: {
          orderBy: { module: { phase: 'asc' } },
          select: {
            module: { select: { id: true, code: true, name: true, phase: true, active: true } },
          },
        },
        adminAccesses: {
          orderBy: { resource: { position: 'asc' } },
          select: {
            resource: { select: { id: true, code: true, name: true, position: true } },
          },
        },
        distributorScopes: { select: { distribuidor: true } },
        clientScopes: { select: { cliente: true } },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.module.findMany({
      select: { id: true, code: true, name: true, phase: true, active: true },
      orderBy: { phase: 'asc' },
    }),
    prisma.adminResource.findMany({
      select: { id: true, code: true, name: true, position: true },
      orderBy: { position: 'asc' },
    }),
    // Universo de clientes pro seletor de escopo (Task 7) — mesmo dataset já
    // usado pelos filtros de venda da Fase 3, sem cadastro novo.
    getDatasetView('fase3_vendas_madeira_tratada').catch(() => []),
  ])

  const clientesDisponiveis = [
    ...new Set((vendasView as Record<string, unknown>[]).map((r) => String(r.CLIENTE ?? '').trim()).filter(Boolean)),
  ].sort()

  return (
    <UserManagement
      currentUserId={currentUser!.id}
      modules={modules}
      resources={resources}
      distribuidoresDisponiveis={[...DISTRIBUIDORES_CONHECIDOS].sort()}
      clientesDisponiveis={clientesDisponiveis}
      users={users.map((user) => ({
        ...user,
        createdAt: user.createdAt.toISOString(),
        moduleCodes: user.moduleAccesses.map((access) => access.module.code),
        resourceCodes: user.adminAccesses.map((access) => access.resource.code),
        distribuidores: user.distributorScopes.map((scope) => scope.distribuidor),
        clientes: user.clientScopes.map((scope) => scope.cliente),
      }))}
    />
  )
}
```

- [ ] **Step 5: Verificar**

Run: `npx tsc --noEmit`
Expected: sem erros.

Teste manual: abrir Cadastros → Usuários, editar um usuário VIEWER,
marcar 1 distribuidor, salvar, reabrir a edição e confirmar que o
distribuidor continua marcado. Repetir com cliente (buscar, adicionar,
salvar, reabrir).

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard/admin/usuarios
git commit -m "feat: tela de usuários ganha restrição por distribuidor/cliente"
```

---

### Task 8: Verificação manual fim a fim

**Files:** nenhum (só verificação — sem código novo)

- [ ] **Step 1: Build completo**

Run: `npm run build`
Expected: build passa sem erro.

- [ ] **Step 2: Cenário — usuário restrito a 1 distribuidor**

1. Em Cadastros → Usuários, criar/editar um usuário VIEWER com acesso à Fase 3, marcando 1 distribuidor (ex. "PLANEP") e nenhum cliente.
2. Logar como esse usuário (ou usar sessão de teste).
3. Abrir Painel Estratégico, Análise por período, Clientes, Clientes potenciais, Melhor carga, Bonificações, Conferência de devoluções e Crítica ao modelo — confirmar que só aparece dado de "PLANEP" em todas.
4. Tentar manipular a URL (ex. adicionar `?distribuidores=TOP+TOP` na aba Estratégico/tático) — confirmar que o resultado continua restrito a "PLANEP" (a URL não deve conseguir escapar do escopo).

- [ ] **Step 3: Cenário — regressão (sem restrição)**

1. Logar como ADMIN e como um usuário VIEWER sem nenhum distribuidor/cliente vinculado.
2. Confirmar que ambos continuam vendo todos os distribuidores/clientes normalmente (nenhuma regressão).

- [ ] **Step 4: Cenário — cascata do combo de cliente**

No Painel Estratégico e na Análise por período, selecionar um distribuidor no filtro-checkbox e abrir o combo de cliente — confirmar que só lista clientes daquele distribuidor.

- [ ] **Step 5: Commit (se algum ajuste foi necessário nos passos anteriores)**

```bash
git add -A
git commit -m "fix: ajustes de verificação manual do escopo de distribuidor/cliente"
```
