# Escopo de acesso por Distribuidor/Cliente + cascata de filtro — Design

Data: 2026-09-11
Escopo: (A) cascata distribuidor → cliente nos filtros da Fase 3; (B) acesso
por usuário restrito a distribuidor(es)/cliente(s) específicos, aplicado
server-side em todas as rotas da Fase 3 que retornam dado de venda.

## Contexto e motivação

Pedido do usuário: "no painel estratégico preciso do filtro de clientes,
preciso do filtro por distribuidor, sendo que quando seleciono o
distribuidor só liste os clientes daquele distribuidor. Nesta linha preciso
ainda que seja criado no cadastro de usuário um acesso onde eu possa
filtrar para que possa ver um ou mais distribuidor e/ou um ou mais cliente.
Não pode ser por filtro de URL, tem que ser inserido em código para evitar
qualquer falha de segurança."

**Decisões já tomadas com o usuário:**
- Usuário sem nenhum vínculo de distribuidor/cliente cadastrado: vê tudo,
  sem restrição (comportamento atual preservado; a restrição é uma exceção
  explícita, não o padrão).
- Escopo vale em **todas** as rotas da Fase 3 que retornam dado por
  distribuidor/cliente (estratégico, tático/período, clientes, clientes
  potenciais, melhor carga, bonificações, conferência de devoluções,
  crítica ao modelo) — não só o Painel Estratégico.
- Quando o usuário tem distribuidor(es) E cliente(s) vinculados ao mesmo
  tempo: união (OR) — vê venda que bata com QUALQUER um dos vínculos, não
  interseção.
- ADMIN sempre sem restrição (mesmo padrão de bypass já usado em
  `isAdmin`/`hasModuleAccess`/`hasResourceAccess`).
- Chave de vínculo: os mesmos valores de string já usados nos filtros
  existentes — `VendaLinha.distribuidor` (bucket ABREV_DISTRIBUIDOR, igual
  ao filtro-checkbox de distribuidor já implementado) e `VendaLinha.cliente`
  (nome, igual ao `ClienteFiltro` combo já implementado) — sem precisar
  mapear código↔nome.
- Enforcement obrigatoriamente server-side, aplicado ANTES de qualquer
  filtro vindo de query string — um usuário restrito não pode ver outro
  distribuidor/cliente manipulando a URL.

## Parte A — cascata distribuidor → cliente

**Achado:** em `src/app/api/fase3/estrategico/route.ts` e
`src/app/api/fase3/data/route.ts`, `clientesDisponiveis` é calculado sobre o
universo inteiro (`linhasAno`/`linhasPeriodo`), ANTES de
`linhasDistribuidorFiltro` existir — por isso o combo de cliente sempre
lista todo mundo, independente do distribuidor selecionado no filtro-
checkbox.

**Fix:** mover o cálculo de `clientesDisponiveis` para depois de
`linhasDistribuidorFiltro` e derivar dali, não de `linhasAno`/`linhasPeriodo`
— mesmo princípio já documentado no arquivo para os outros filtros
("sempre sobre o filtro anterior, nunca sobre si mesmo"): a lista de
clientes reflete o distribuidor selecionado, mas continua mostrando todas
as opções de cliente possíveis para aquele distribuidor (não filtra pelo
cliente já selecionado, senão o combo "sumiria" ao selecionar).

## Parte B — escopo de acesso por usuário

### 1. Modelo de dados (Prisma)

Duas tabelas novas, mesmo padrão de `UserModuleAccess`/`UserAdminAccess`:

```prisma
model UserDistributorScope {
  userId       String   @map("user_id")
  distribuidor String
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt    DateTime @default(now()) @map("created_at")

  @@id([userId, distribuidor])
  @@map("user_distributor_scopes")
}

model UserClientScope {
  userId    String   @map("user_id")
  cliente   String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now()) @map("created_at")

  @@id([userId, cliente])
  @@map("user_client_scopes")
}
```

`User` ganha as relações inversas `distributorScopes UserDistributorScope[]`
e `clientScopes UserClientScope[]`.

### 2. Sessão (`src/lib/authz.ts`)

`SessionUser` ganha:

```ts
escopoVendas: { distribuidores: string[]; clientes: string[] } | null
```

Resolvido em `getSessionUser()` a partir de `distributorScopes`/
`clientScopes` do usuário — `null` quando ADMIN ou quando as duas listas
vêm vazias do banco (sem vínculo = sem restrição); não-`null` só quando
existe pelo menos um vínculo em qualquer uma das duas tabelas.

### 3. Enforcement — helper compartilhado

Novo arquivo `src/lib/fase3/escopo-usuario.ts`:

```ts
export function aplicarEscopoUsuario(linhas: VendaLinha[], escopo: SessionUser['escopoVendas']): VendaLinha[] {
  if (!escopo) return linhas
  return linhas.filter((l) => escopo.distribuidores.includes(l.distribuidor) || escopo.clientes.includes(l.cliente))
}
```

Chamado logo após `prepararVendas(...)` e ANTES de qualquer leitura de
`req.nextUrl.searchParams` que vire filtro, nas 8 rotas:
`estrategico`, `data`, `clientes`, `clientes-potenciais`, `melhor-carga`,
`bonificacoes`, `conferencia-devolucoes`, `critica`.

### 4. Admin UI

`src/app/dashboard/admin/usuarios/UserManagement.tsx`: dois multi-select
novos (Distribuidores / Clientes) na tela de edição de usuário, mesmo
padrão visual dos checkboxes de módulo/cadastro já existentes. Populados a
partir de `DISTRIBUIDORES_CONHECIDOS` (distribuidor) e da lista de clientes
distintos do dataset `fase3_vendas_madeira_tratada` (cliente) — não exigem
cadastro novo, reaproveitam dado já sincronizado.

`src/app/api/admin/users/[id]/route.ts`: `updateSchema` ganha
`distribuidores: string[]` e `clientes: string[]` (default `[]`,
deduplicados); mesma transação de update faz `deleteMany` + `create` nas 2
tabelas novas, mesmo padrão de `moduleAccesses`/`adminAccesses`. Auditoria
(`logAudit`) registra `before`/`after` dos dois campos, mesmo padrão dos
demais.

### 5. Migração

Migration Prisma pura (2 `CREATE TABLE`, sem dado a migrar — tabelas
novas, vazias até alguém vincular um usuário).

## Testando

Sem infraestrutura de teste automatizado no projeto (confirmado: nenhum
`*.test.*`/`*.spec.*`, nenhum runner configurado). Verificação via:
- `npm run build`/typecheck depois da migration + mudanças.
- Teste manual: criar vínculo de distribuidor num usuário VIEWER, logar
  como ele, confirmar que as 8 rotas da Fase 3 só retornam linhas daquele
  distribuidor mesmo tentando outro valor na URL (`?distribuidores=...`).
- Confirmar que ADMIN e usuário sem vínculo continuam vendo tudo (regressão).

## Fora de escopo (não pedido, não implementar)

- Não criar um papel/perfil novo — o escopo é um vínculo adicional sobre
  o usuário existente (ADMIN/EDITOR/VIEWER), não um novo `UserRole`.
- Não mapear cliente por CODCFO — usa o nome já usado nos filtros
  existentes (decisão explícita, evita lookup novo).
- Não estender o escopo pra fora da Fase 3 (Fase 1, RH, etc.) — não foi
  pedido e essas fases não têm o conceito de distribuidor/cliente.
