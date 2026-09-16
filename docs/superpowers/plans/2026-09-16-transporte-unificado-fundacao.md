# Transporte Unificado — Fundação (cadastro + classificador) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar a base de dados e o cadastro do módulo "Transporte" unificado: registro central de veículo (com o flag de rastreamento Omnilink), regras de classificação de tipo de transporte parametrizadas, o dataset novo de movimentação interna, e o classificador que liga tudo isso.

**Architecture:** Duas tabelas Prisma novas (`Vehicle`, `TransportTypeRule`) mais uma extensão de enum (`LocationType.TALHAO`), um dataset novo e enxuto (`transporte_movimentos_internos`, só tipos 2-4) que não toca em `fase1_vendas_transporte`, um classificador puro em `src/lib/transporte/` que decide o tipo de cada linha a partir das regras cadastradas, e duas telas de Cadastro (Veículos, Regras de Transporte) seguindo o padrão visual/API já usado em Produtos/Composições.

**Tech Stack:** Next.js (App Router), Prisma + PostgreSQL, Zod, TypeScript.

**Spec:** `docs/superpowers/specs/2026-09-15-transporte-unificado-design.md`

## Global Constraints

- Não alterar `fase1_vendas_transporte` (query, dataset ou incremental field) — Fase 1/Fase 5 dependem dela como está.
- Regras de classificação (CODTMV, produto, origem, destino) ficam cadastradas em `TransportTypeRule`, nunca hardcoded em SQL ou em código.
- `Vehicle` complementa, não substitui, a resolução de transportadora via CODTRA já existente (dataset `dtransportadoras_rm`) — não duplicar nome/propriedade.
- Este projeto não tem framework de testes automatizados configurado (sem jest/vitest, sem scripts de teste) — a verificação de cada passo usa `npx tsc --noEmit`, execução manual via `npx tsx` (já usado em `db:seed`) para funções puras, e checagem manual via `curl`/navegador para rotas HTTP. Isso substitui os passos "rodar o teste" do template padrão desta skill.
- Escopo desta fundação **não inclui** a tela do módulo Transporte (abas, Visão Geral da Frota) nem o fechamento de custo ponderado no painel estratégico — isso é um plano separado (Plano 2), depois que a fundação estiver no ar.

---

### Task 1: Schema Prisma — `Vehicle`, `TransportTypeRule`, `LocationType.TALHAO`

**Files:**
- Modify: `prisma/schema.prisma:372-383` (enum `LocationType`)
- Modify: `prisma/schema.prisma` (novo bloco antes de `model VehicleMaintenance` na linha 614)

**Interfaces:**
- Produces: `model Vehicle { id, placa, precisaRastreamento, codTra, ativo, observacoes, createdAt, updatedAt }`, `model TransportTypeRule { id, tipo, prioridade, codtmv, produtos, origemColigada, origemFilial, destinoColigada, destinoFilial, ativo, createdAt, updatedAt }`, `enum LocationType { ..., TALHAO }` — usados por todas as tasks seguintes via `prisma.vehicle`/`prisma.transportTypeRule`.

- [ ] **Step 1: Adicionar `TALHAO` ao enum `LocationType`**

Em `prisma/schema.prisma`, dentro do enum `LocationType` (linhas 372-383), adicionar antes do `}` de fechamento:

```prisma
  // Origem do transporte "madeira para carvão" (tipo 3 do módulo Transporte
  // unificado, pedido do usuário 2026-09-15) — talhão de origem da madeira
  // antes de ir para a unidade de carbonização. Sem match* definido ainda —
  // validação de como resolver a partir do dado real fica para a
  // implementação do classificador (ver spec, seção B.3).
  TALHAO
```

- [ ] **Step 2: Adicionar o model `Vehicle`**

Em `prisma/schema.prisma`, imediatamente antes de `model VehicleMaintenance {` (linha 614), inserir:

```prisma
// Cadastro central de veículo — pedido do usuário 2026-09-15: hoje a placa
// é uma string solta em ~8 cadastros diferentes (PlateComposition,
// VehiclePosition, SpeedAlert, VehicleMaintenance, DriverVacation,
// TripTicket...), sem um registro único. Este model COMPLEMENTA, não
// substitui, a resolução de transportadora que já existe (CODTRA → nome
// via dataset dtransportadoras_rm, bucket Próprio/Outros) — só guarda o
// que ainda não existe em lugar nenhum: a placa como registro central e o
// flag de rastreamento. Os cadastros existentes continuam ligados por
// placa (string), sem FK obrigatória por enquanto — ver spec
// docs/superpowers/specs/2026-09-15-transporte-unificado-design.md.
model Vehicle {
  id                  String   @id @default(uuid())
  placa               String   @unique
  // false = caminhão sem rastreamento Omnilink (pedido do usuário
  // 2026-09-15: "vamos ter caminhoes sem rastreamento, assim vamos
  // precisar de um flag no cadastro para saber se precisa ou não ir na
  // ominilink").
  precisaRastreamento Boolean  @default(true) @map("precisa_rastreamento")
  // Referência opcional de volta ao CODTRA já resolvido pelo lookup
  // existente (nome/Próprio-Outros continuam vindo de lá, não duplicados
  // aqui).
  codTra              String?  @map("cod_tra")
  ativo               Boolean  @default(true)
  observacoes         String?
  createdAt           DateTime @default(now()) @map("created_at")
  updatedAt           DateTime @updatedAt @map("updated_at")

  @@map("vehicles")
}

// Regra de classificação de movimentação de transporte em um dos 4 tipos
// de negócio (pedido do usuário 2026-09-15) — cadastro dedicado em vez do
// Parameter genérico porque a regra tem várias dimensões (CODTMV, produto,
// origem, destino) que não cabem bem num campo de texto único. Testada em
// ordem de `prioridade`; primeira regra cujos campos preenchidos batem
// TODOS com a linha, vence. Campo null = "não filtra por isso".
model TransportTypeRule {
  id              String   @id @default(uuid())
  // 'venda_rodoviaria' | 'transferencia_interna' | 'talhao_carbonizacao' | 'tratamento'
  tipo            String
  prioridade      Int      @default(0)
  codtmv          String?
  // lista separada por vírgula de CODIGOPRD, mesmo formato de paramList (cotas.ts)
  produtos        String?
  origemColigada  Int?     @map("origem_coligada")
  origemFilial    Int?     @map("origem_filial")
  destinoColigada Int?     @map("destino_coligada")
  destinoFilial   Int?     @map("destino_filial")
  ativo           Boolean  @default(true)
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  @@index([ativo, prioridade])
  @@map("transport_type_rules")
}
```

- [ ] **Step 3: Formatar e validar o schema**

Run: `npx prisma format && npx prisma validate`
Expected: sem erro, schema reformatado.

- [ ] **Step 4: Criar e aplicar a migração**

Run: `npx prisma migrate dev --name add_vehicle_and_transport_type_rule`
Expected: migração criada em `prisma/migrations/`, aplicada no banco de dev, `prisma generate` rodado automaticamente ao final.

- [ ] **Step 5: Checagem de tipos**

Run: `npx tsc --noEmit`
Expected: sem erro (confirma que o client Prisma gerado expõe `prisma.vehicle`/`prisma.transportTypeRule`).

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: cadastro Vehicle e TransportTypeRule, LocationType.TALHAO"
```

---

### Task 2: Seed — AdminResources + dataset `transporte_movimentos_internos`

**Files:**
- Modify: `prisma/seed.ts:433-444` (array `adminResources`)
- Modify: `prisma/seed.ts` (novo bloco após o registro do dataset `fase1_vendas_transporte`, por volta da linha 578)

**Interfaces:**
- Consumes: `prisma.dataset`, `prisma.syncSchedule`, `prisma.adminResource` (Prisma Client, já existente).
- Produces: `AdminResource` rows com `code: 'veiculos'` e `code: 'regras_transporte'` (consumidos pelas Tasks 4-7 via `requireResourceViewer`/`requireResourceEditor`); `Dataset` row `code: 'transporte_movimentos_internos'` (consumido pela Task 3 e por qualquer sync futuro).

- [ ] **Step 1: Adicionar as duas novas linhas de `AdminResource`**

Em `prisma/seed.ts`, dentro do array `adminResources` (linhas 433-444), adicionar antes do fechamento `]`:

```ts
    { code: 'veiculos', name: 'Veículos', position: 11 },
    { code: 'regras_transporte', name: 'Regras de Transporte', position: 12 },
```

- [ ] **Step 2: Adicionar a query da nova extração**

Em `prisma/seed.ts`, logo após a declaração de `QUERY_FASE1_VENDAS` (antes do comentário que introduz `QUERY_FASE3_VENDAS_MADEIRA`, por volta da linha 90), adicionar:

```ts
// Consulta do módulo Transporte unificado (pedido do usuário 2026-09-15) —
// só os tipos 2-4 (movimentação INTERNA: transferência entre unidades,
// madeira para carvão, madeira para tratamento). Tipo 1 (venda) continua
// vindo de QUERY_FASE1_VENDAS, sem duplicação. Deliberadamente enxuta: sem
// FCFO/FCFOCOMPL/GCONSIST (não há cliente numa movimentação interna) e sem
// filtro de produto/destino no SQL — a classificação em tipo 2/3/4 é feita
// em código por `classificarTipoTransporte` (src/lib/transporte/
// classificador.ts), a partir das regras cadastradas em TransportTypeRule.
// CODLOC e CODCFO vão crus para o classificador resolver o destino (ver
// spec, seção B.3 — ponto de validação contra dado real).
const QUERY_TRANSPORTE_INTERNO = `
SELECT
TMOV.CODCOLIGADA,
TMOV.CODFILIAL,
TMOV.IDMOV,
TMOV.NUMEROMOV,
TMOV.DATASAIDA,
TMOV.CODTMV,
TMOV.CODLOC,
TMOV.CODCFO,
TMOV.PESOBRUTO,
TMOV.PESOLIQUIDO,
TMOV.CODTRA,
TPRD.CODIGOPRD,
TITMMOV.QUANTIDADE,
TMOVCOMPL.PLACA,
TMOVCOMPL.MOTORISTA,
GREATEST(NVL(TMOV.RECMODIFIEDON,TMOV.RECCREATEDON), NVL(TITMMOV.RECMODIFIEDON,TITMMOV.RECCREATEDON)) RECMODIFIEDON
FROM    RM.TMOV, RM.TMOVCOMPL, RM.TITMMOV, RM.TPRD
WHERE   TMOV.CODCOLIGADA = TITMMOV.CODCOLIGADA
AND     TMOV.IDMOV = TITMMOV.IDMOV
AND     TITMMOV.CODCOLIGADA = TPRD.CODCOLIGADA
AND     TITMMOV.IDPRD = TPRD.IDPRD
AND     TMOV.IDMOV = TMOVCOMPL.IDMOV
AND     TMOV.CODCOLIGADA = TMOVCOMPL.CODCOLIGADA
AND (
     (TMOV.CODCOLIGADA = 5 AND TMOV.CODFILIAL IN (3,4,6,11,12,13))
  OR (TMOV.CODCOLIGADA = 6 AND TMOV.CODFILIAL IN (3,4,6,7,8,9,10,11,12))
  OR (TMOV.CODCOLIGADA = 28 AND TMOV.CODFILIAL IN (4,5,6))
  OR (TMOV.CODCOLIGADA = 33 AND TMOV.CODFILIAL IN (1))
  OR (TMOV.CODCOLIGADA = 34 AND TMOV.CODFILIAL IN (1))
  )
AND TMOV.CODTMV IN ('2.2.28','2.2.88')
AND TMOV.STATUS <> 'C'
`.trim()
```

- [ ] **Step 3: Registrar o dataset e o agendamento de sync**

Em `prisma/seed.ts`, logo após o bloco que cria `syncSchedule` para `fase1_vendas_transporte` (após a linha 578, antes do comentário `--- Dataset: transportadoras ---`), adicionar:

```ts
  // --- Dataset Transporte: movimentações internas (tipos 2-4) ---
  const datasetTransporteInterno = await prisma.dataset.upsert({
    where: { code: 'transporte_movimentos_internos' },
    update: { query: QUERY_TRANSPORTE_INTERNO, incrementalField: 'RECMODIFIEDON', incrementalType: 'DATETIME' },
    create: {
      dataSourceId: oracle.id,
      code: 'transporte_movimentos_internos',
      name: 'Transporte — Movimentações internas (TOTVS RM)',
      description:
        'Transferência entre unidades, madeira para carvão e madeira para tratamento — base do módulo Transporte unificado para os tipos que não são venda (tipo 1, que continua em fase1_vendas_transporte).',
      query: QUERY_TRANSPORTE_INTERNO,
      primaryKeyFields: 'CODCOLIGADA,CODFILIAL,IDMOV,CODIGOPRD',
      incrementalField: 'RECMODIFIEDON',
      incrementalType: 'DATETIME',
    },
  })

  await prisma.syncSchedule.upsert({
    where: { datasetId: datasetTransporteInterno.id },
    update: {},
    create: { datasetId: datasetTransporteInterno.id, intervalMinutes: 60 },
  })
```

- [ ] **Step 4: Rodar o seed**

Run: `npm run db:seed`
Expected: termina sem erro; log mostra os upserts (ou ao menos não lança exceção).

- [ ] **Step 5: Conferir no banco**

Run: `npx prisma studio` (ou uma query rápida) para confirmar `admin_resources` tem `veiculos`/`regras_transporte` e `datasets` tem `transporte_movimentos_internos` com `data_source_id` preenchido.
Expected: as 3 linhas existem.

- [ ] **Step 6: Commit**

```bash
git add prisma/seed.ts
git commit -m "feat: dataset transporte_movimentos_internos e AdminResources de veiculos/regras_transporte"
```

---

### Task 3: Classificador (`src/lib/transporte/`)

**Files:**
- Create: `src/lib/transporte/tipos.ts`
- Create: `src/lib/transporte/classificador.ts`

**Interfaces:**
- Consumes: `prisma.transportTypeRule.findMany` (Task 1/2).
- Produces: `TipoTransporte` (type), `TIPOS_TRANSPORTE_CONHECIDOS: { code: TipoTransporte; label: string }[]` (usado pela Task 7, UI de regras), `MovimentoTransporteInterno` (interface), `RegraTransporte` (interface), `carregarRegrasTransporte(): Promise<RegraTransporte[]>`, `resolverDestino(linha): { codColigada: number; codFilial: number } | null`, `classificarTipoTransporte(linha, regras): string | null` — usados por qualquer rota/relatório futuro que precise classificar uma linha do dataset `transporte_movimentos_internos`.

- [ ] **Step 1: Criar os tipos compartilhados (sem import de Prisma — usado também no client)**

Create `src/lib/transporte/tipos.ts`:

```ts
export type TipoTransporte =
  | 'venda_rodoviaria'
  | 'transferencia_interna'
  | 'talhao_carbonizacao'
  | 'tratamento'

/**
 * Tipos conhecidos pelo módulo Transporte unificado (pedido do usuário
 * 2026-09-15) — usado como sugestão na tela de cadastro de regras
 * (TransportTypeRule.tipo aceita qualquer string, mas estes 4 já cobrem os
 * fluxos identificados). Ver docs/superpowers/specs/2026-09-15-transporte-unificado-design.md.
 */
export const TIPOS_TRANSPORTE_CONHECIDOS: { code: TipoTransporte; label: string }[] = [
  { code: 'venda_rodoviaria', label: 'Venda rodoviária (carvão, cavaco, madeira tratada)' },
  { code: 'transferencia_interna', label: 'Transferência interna entre unidades' },
  { code: 'talhao_carbonizacao', label: 'Madeira para carvão (talhão → carbonização)' },
  { code: 'tratamento', label: 'Madeira para tratamento' },
]
```

- [ ] **Step 2: Criar o classificador**

Create `src/lib/transporte/classificador.ts`:

```ts
import { prisma } from '@/lib/prisma'

export interface MovimentoTransporteInterno {
  codColigada: number
  codFilial: number
  idMov: string
  numeroMov: string
  codtmv: string
  codigoPrd: string
  codLoc: string | null
  codCfo: string | null
}

export interface RegraTransporte {
  tipo: string
  prioridade: number
  codtmv: string | null
  produtos: string[] | null
  origemColigada: number | null
  origemFilial: number | null
  destinoColigada: number | null
  destinoFilial: number | null
}

/** Carrega as regras ativas, em ordem de prioridade (primeira que bater, vence). */
export async function carregarRegrasTransporte(): Promise<RegraTransporte[]> {
  const rows = await prisma.transportTypeRule.findMany({ where: { ativo: true }, orderBy: { prioridade: 'asc' } })
  return rows.map((r) => ({
    tipo: r.tipo,
    prioridade: r.prioridade,
    codtmv: r.codtmv,
    produtos: r.produtos ? r.produtos.split(',').map((v) => v.trim()).filter(Boolean) : null,
    origemColigada: r.origemColigada,
    origemFilial: r.origemFilial,
    destinoColigada: r.destinoColigada,
    destinoFilial: r.destinoFilial,
  }))
}

/**
 * Resolve coligada/filial de destino de uma movimentação interna — hoje só
 * via CODLOC no formato "<codColigada>.<codFilial>" (ex. "5.3"). PONTO DE
 * VALIDAÇÃO (spec, seção B.3): confirmar contra dado real se é este o
 * formato de CODLOC usado pelo TOTVS para essas movimentações, ou se o
 * destino vem de CODCFO (mapeado por um cadastro Location tipo UNIDADE) —
 * sem confirmação ainda, `codCfo` não é usado. Retorna `null` quando não dá
 * para resolver (a linha fica "não classificada").
 */
export function resolverDestino(linha: MovimentoTransporteInterno): { codColigada: number; codFilial: number } | null {
  if (!linha.codLoc) return null
  const partes = linha.codLoc.split('.')
  if (partes.length !== 2) return null
  const codColigada = Number(partes[0])
  const codFilial = Number(partes[1])
  if (!Number.isFinite(codColigada) || !Number.isFinite(codFilial)) return null
  return { codColigada, codFilial }
}

/**
 * Primeira regra (em ordem de prioridade) cujos campos preenchidos batem
 * TODOS com a linha, vence. Campo null na regra = "não filtra por isso".
 * Sem regra correspondente, retorna `null` (linha "não classificada").
 */
export function classificarTipoTransporte(linha: MovimentoTransporteInterno, regras: RegraTransporte[]): string | null {
  const destino = resolverDestino(linha)
  for (const regra of regras) {
    if (regra.codtmv && regra.codtmv !== linha.codtmv) continue
    if (regra.produtos && !regra.produtos.includes(linha.codigoPrd)) continue
    if (regra.origemColigada != null && regra.origemColigada !== linha.codColigada) continue
    if (regra.origemFilial != null && regra.origemFilial !== linha.codFilial) continue
    if (regra.destinoColigada != null && destino?.codColigada !== regra.destinoColigada) continue
    if (regra.destinoFilial != null && destino?.codFilial !== regra.destinoFilial) continue
    return regra.tipo
  }
  return null
}
```

- [ ] **Step 3: Checagem de tipos**

Run: `npx tsc --noEmit`
Expected: sem erro.

- [ ] **Step 4: Verificação manual das funções puras**

Run (sem tocar o banco — `resolverDestino`/`classificarTipoTransporte` são puras):

```bash
npx tsx -e "
import { resolverDestino, classificarTipoTransporte, type MovimentoTransporteInterno, type RegraTransporte } from './src/lib/transporte/classificador'

const regras: RegraTransporte[] = [
  { tipo: 'tratamento', prioridade: 0, codtmv: '2.2.88', produtos: null, origemColigada: null, origemFilial: null, destinoColigada: 5, destinoFilial: 3 },
  { tipo: 'talhao_carbonizacao', prioridade: 1, codtmv: '2.2.88', produtos: null, origemColigada: null, origemFilial: null, destinoColigada: null, destinoFilial: null },
  { tipo: 'transferencia_interna', prioridade: 2, codtmv: '2.2.28', produtos: null, origemColigada: null, origemFilial: null, destinoColigada: null, destinoFilial: null },
]

const paraTratamento: MovimentoTransporteInterno = { codColigada: 6, codFilial: 4, idMov: '1', numeroMov: '1', codtmv: '2.2.88', codigoPrd: 'X', codLoc: '5.3', codCfo: null }
const paraCarbonizacao: MovimentoTransporteInterno = { codColigada: 6, codFilial: 4, idMov: '2', numeroMov: '2', codtmv: '2.2.88', codigoPrd: 'X', codLoc: '6.9', codCfo: null }
const transferencia: MovimentoTransporteInterno = { codColigada: 5, codFilial: 3, idMov: '3', numeroMov: '3', codtmv: '2.2.28', codigoPrd: 'X', codLoc: null, codCfo: null }

console.assert(resolverDestino(paraTratamento)?.codColigada === 5, 'destino coligada deveria ser 5')
console.assert(classificarTipoTransporte(paraTratamento, regras) === 'tratamento', 'deveria classificar como tratamento')
console.assert(classificarTipoTransporte(paraCarbonizacao, regras) === 'talhao_carbonizacao', 'deveria classificar como talhao_carbonizacao')
console.assert(classificarTipoTransporte(transferencia, regras) === 'transferencia_interna', 'deveria classificar como transferencia_interna')
console.log('OK — classificador se comporta como esperado')
"
```

Expected: imprime `OK — classificador se comporta como esperado`, sem nenhum `Assertion failed`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/transporte
git commit -m "feat: classificador de tipo de transporte (venda/transferencia/carbonizacao/tratamento)"
```

---

### Task 4: API de cadastro — `Vehicle`

**Files:**
- Create: `src/app/api/admin/vehicles/route.ts`
- Create: `src/app/api/admin/vehicles/[id]/route.ts`

**Interfaces:**
- Consumes: `requireResourceViewer`/`requireResourceEditor`/`badRequest` (`@/lib/api-helpers`), `logAudit` (`@/lib/audit`), `prisma.vehicle` (Task 1).
- Produces: `GET /api/admin/vehicles` → `Vehicle[]`; `POST /api/admin/vehicles` → `Vehicle` (201); `PUT /api/admin/vehicles/:id` → `Vehicle`; `DELETE /api/admin/vehicles/:id` → `{ ok: true }`. Consumido pela Task 5 (UI).

- [ ] **Step 1: Rota de listagem e criação**

Create `src/app/api/admin/vehicles/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { requireResourceViewer, requireResourceEditor, badRequest } from '@/lib/api-helpers'

const vehicleSchema = z.object({
  placa: z.string().min(1).transform((v) => v.trim().toUpperCase()),
  precisaRastreamento: z.boolean().optional(),
  codTra: z.string().nullable().optional(),
  ativo: z.boolean().optional(),
  observacoes: z.string().nullable().optional(),
})

export async function GET() {
  const auth = await requireResourceViewer('veiculos')
  if ('error' in auth) return auth.error
  const vehicles = await prisma.vehicle.findMany({ orderBy: { placa: 'asc' } })
  return NextResponse.json(vehicles)
}

export async function POST(req: NextRequest) {
  const auth = await requireResourceEditor('veiculos')
  if ('error' in auth) return auth.error
  const parsed = vehicleSchema.safeParse(await req.json())
  if (!parsed.success) return badRequest(parsed.error.issues.map((i) => i.message).join('; '))

  const vehicle = await prisma.vehicle.create({ data: parsed.data })
  await logAudit({
    userId: auth.user.id,
    userName: auth.user.name,
    action: 'CREATE',
    entity: 'Vehicle',
    entityId: vehicle.id,
    details: parsed.data,
  })
  return NextResponse.json(vehicle, { status: 201 })
}
```

- [ ] **Step 2: Rota de atualização e exclusão**

Create `src/app/api/admin/vehicles/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { requireResourceEditor, badRequest } from '@/lib/api-helpers'

const updateSchema = z.object({
  precisaRastreamento: z.boolean().optional(),
  codTra: z.string().nullable().optional(),
  ativo: z.boolean().optional(),
  observacoes: z.string().nullable().optional(),
})

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireResourceEditor('veiculos')
  if ('error' in auth) return auth.error
  const { id } = await params
  const parsed = updateSchema.safeParse(await req.json())
  if (!parsed.success) return badRequest(parsed.error.issues.map((i) => i.message).join('; '))

  const vehicle = await prisma.vehicle.update({ where: { id }, data: parsed.data })
  await logAudit({
    userId: auth.user.id,
    userName: auth.user.name,
    action: 'UPDATE',
    entity: 'Vehicle',
    entityId: id,
    details: parsed.data,
  })
  return NextResponse.json(vehicle)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireResourceEditor('veiculos')
  if ('error' in auth) return auth.error
  const { id } = await params
  await prisma.vehicle.delete({ where: { id } })
  await logAudit({
    userId: auth.user.id,
    userName: auth.user.name,
    action: 'DELETE',
    entity: 'Vehicle',
    entityId: id,
  })
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 3: Checagem de tipos**

Run: `npx tsc --noEmit`
Expected: sem erro.

- [ ] **Step 4: Verificação manual end-to-end**

Suba o servidor de dev (`npm run dev`, porta 3002) e, autenticado como ADMIN no navegador (para copiar o cookie de sessão) ou usando uma sessão de teste, rode:

```bash
curl -s -X POST http://localhost:3002/api/admin/vehicles -H "Content-Type: application/json" -H "Cookie: <cookie de sessão admin>" -d '{"placa":"ABC1234","precisaRastreamento":false,"observacoes":"sem rastreador, frota terceirizada"}'
curl -s http://localhost:3002/api/admin/vehicles -H "Cookie: <cookie de sessão admin>"
```

Expected: primeiro comando devolve o veículo criado com `precisaRastreamento: false`; segundo comando lista o veículo criado.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/vehicles
git commit -m "feat: API de cadastro de veiculos (CRUD)"
```

---

### Task 5: Tela de cadastro — Veículos

**Files:**
- Create: `src/app/dashboard/admin/veiculos/page.tsx`
- Modify: `src/app/dashboard/admin/page.tsx` (adicionar contagem + card)

**Interfaces:**
- Consumes: `GET/POST /api/admin/vehicles`, `PUT/DELETE /api/admin/vehicles/:id` (Task 4); `SortableTable` (`@/components/shared/SortableTable`).

- [ ] **Step 1: Criar a página de cadastro**

Create `src/app/dashboard/admin/veiculos/page.tsx`:

```tsx
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { SortableTable, type SortableColumn } from '@/components/shared/SortableTable'

interface VehicleRecord {
  id: string
  placa: string
  precisaRastreamento: boolean
  codTra: string | null
  ativo: boolean
  observacoes: string | null
}

const EMPTY = { placa: '', precisaRastreamento: true, codTra: '', ativo: true, observacoes: '' }

export default function VeiculosPage() {
  const [vehicles, setVehicles] = useState<VehicleRecord[]>([])
  const [form, setForm] = useState(EMPTY)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState('')

  const filtered = useMemo(() => {
    const f = filter.trim().toUpperCase()
    if (!f) return vehicles
    return vehicles.filter((v) => [v.placa, v.codTra, v.observacoes].filter(Boolean).some((s) => String(s).toUpperCase().includes(f)))
  }, [vehicles, filter])

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/vehicles')
    if (res.ok) setVehicles(await res.json())
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  function startEdit(v: VehicleRecord) {
    setEditingId(v.id)
    setForm({
      placa: v.placa,
      precisaRastreamento: v.precisaRastreamento,
      codTra: v.codTra ?? '',
      ativo: v.ativo,
      observacoes: v.observacoes ?? '',
    })
    setError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const payload: Record<string, unknown> = {
      precisaRastreamento: form.precisaRastreamento,
      codTra: form.codTra === '' ? null : form.codTra,
      ativo: form.ativo,
      observacoes: form.observacoes === '' ? null : form.observacoes,
    }
    if (!editingId) payload.placa = form.placa
    const res = await fetch(editingId ? `/api/admin/vehicles/${editingId}` : '/api/admin/vehicles', {
      method: editingId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setSaving(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Falha ao salvar')
      return
    }
    setForm(EMPTY)
    setEditingId(null)
    load()
  }

  async function remove(id: string) {
    if (!confirm('Excluir este veículo?')) return
    const res = await fetch(`/api/admin/vehicles/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Falha ao excluir')
      return
    }
    load()
  }

  const columns: SortableColumn<VehicleRecord>[] = [
    { key: 'placa', label: 'Placa', sortValue: (v) => v.placa, render: (v) => <span className="font-mono text-sm font-medium">{v.placa}</span> },
    {
      key: 'rastreamento',
      label: 'Rastreamento',
      sortValue: (v) => (v.precisaRastreamento ? 1 : 0),
      render: (v) =>
        v.precisaRastreamento ? (
          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">Omnilink</span>
        ) : (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">sem rastreamento</span>
        ),
    },
    { key: 'codTra', label: 'CODTRA', sortValue: (v) => v.codTra ?? '', render: (v) => v.codTra ?? '—' },
    {
      key: 'ativo',
      label: 'Situação',
      sortValue: (v) => (v.ativo ? 1 : 0),
      render: (v) => (v.ativo ? 'Ativo' : 'Inativo'),
    },
    { key: 'observacoes', label: 'Observações', sortValue: (v) => v.observacoes ?? '', render: (v) => v.observacoes ?? '—' },
    {
      key: 'acoes',
      label: '',
      sortValue: () => 0,
      render: (v) => (
        <span className="whitespace-nowrap">
          <button onClick={() => startEdit(v)} className="text-emerald-700 hover:underline">
            Editar
          </button>
          <button onClick={() => remove(v.id)} className="ml-3 text-red-600 hover:underline">
            Excluir
          </button>
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Veículos</h1>
        <p className="text-sm text-slate-500">
          Cadastro central da frota (placa) — complementa a resolução de transportadora já existente por CODTRA,
          só adicionando o que ainda não existe: registro por placa e se o veículo precisa reportar rastreamento
          (Omnilink) ou não.
        </p>
      </div>

      <form onSubmit={save} className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-medium">{editingId ? 'Editar veículo' : 'Novo veículo'}</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div>
            <label className="block text-xs font-medium text-slate-600">Placa</label>
            <input
              required
              disabled={!!editingId}
              value={form.placa}
              onChange={(e) => setForm({ ...form, placa: e.target.value.toUpperCase() })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 font-mono text-sm disabled:bg-slate-100"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">CODTRA (opcional)</label>
            <input
              value={form.codTra}
              onChange={(e) => setForm({ ...form, codTra: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-600">Observações</label>
            <input
              value={form.observacoes}
              onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.precisaRastreamento}
              onChange={(e) => setForm({ ...form, precisaRastreamento: e.target.checked })}
              className="h-3.5 w-3.5"
            />
            Precisa reportar rastreamento (Omnilink)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.ativo}
              onChange={(e) => setForm({ ...form, ativo: e.target.checked })}
              className="h-3.5 w-3.5"
            />
            Ativo
          </label>
        </div>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <div className="mt-3 flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-emerald-700 px-4 py-1.5 text-sm text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            {saving ? 'Salvando…' : editingId ? 'Salvar alterações' : 'Adicionar'}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={() => {
                setEditingId(null)
                setForm(EMPTY)
              }}
              className="rounded-md border border-slate-300 px-4 py-1.5 text-sm hover:bg-slate-100"
            >
              Cancelar
            </button>
          )}
        </div>
      </form>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <span className="font-medium">Veículos cadastrados ({filtered.length})</span>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="filtrar placa, CODTRA, observações…"
            className="w-72 rounded-md border border-slate-300 px-2 py-1 text-sm"
          />
        </div>
        <SortableTable columns={columns} rows={filtered} rowKey={(v) => v.id} defaultSortKey="placa" defaultSortDir="asc" emptyMessage="Nenhum veículo cadastrado." />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Registrar o card na página de Cadastros**

Em `src/app/dashboard/admin/page.tsx`:

1. No `Promise.all` (linhas 18-32), adicionar `prisma.vehicle.count()` como mais um item, e adicionar `veiculos` na desestruturação correspondente.
2. No array `cardsPorRecurso` (antes do `].filter(...)` da linha 108), adicionar:

```ts
    {
      resource: 'veiculos',
      href: '/dashboard/admin/veiculos',
      title: 'Veículos',
      count: veiculos,
      desc: 'Cadastro central da frota — placa, situação e se precisa reportar rastreamento (Omnilink).',
    },
```

- [ ] **Step 3: Checagem de tipos**

Run: `npx tsc --noEmit`
Expected: sem erro.

- [ ] **Step 4: Verificação manual**

Suba o servidor (`npm run dev`), acesse `/dashboard/admin` logado como ADMIN, confirme que o card "Veículos" aparece com a contagem certa, entre em `/dashboard/admin/veiculos`, cadastre um veículo de teste com "sem rastreamento", edite-o e exclua-o.
Expected: as 3 operações funcionam sem erro na tela.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/admin/veiculos src/app/dashboard/admin/page.tsx
git commit -m "feat: tela de cadastro de veiculos"
```

---

### Task 6: API de cadastro — `TransportTypeRule`

**Files:**
- Create: `src/app/api/admin/transport-type-rules/route.ts`
- Create: `src/app/api/admin/transport-type-rules/[id]/route.ts`

**Interfaces:**
- Consumes: `requireResourceViewer`/`requireResourceEditor`/`badRequest` (`@/lib/api-helpers`), `logAudit`, `prisma.transportTypeRule` (Task 1).
- Produces: `GET /api/admin/transport-type-rules` → `TransportTypeRule[]`; `POST` → `TransportTypeRule` (201); `PUT /:id` → `TransportTypeRule`; `DELETE /:id` → `{ ok: true }`. Consumido pela Task 7 (UI) e por `carregarRegrasTransporte` (Task 3, via Prisma direto).

- [ ] **Step 1: Rota de listagem e criação**

Create `src/app/api/admin/transport-type-rules/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { requireResourceViewer, requireResourceEditor, badRequest } from '@/lib/api-helpers'

const ruleSchema = z.object({
  tipo: z.string().min(1),
  prioridade: z.number().int().optional(),
  codtmv: z.string().nullable().optional(),
  produtos: z.string().nullable().optional(),
  origemColigada: z.number().int().nullable().optional(),
  origemFilial: z.number().int().nullable().optional(),
  destinoColigada: z.number().int().nullable().optional(),
  destinoFilial: z.number().int().nullable().optional(),
  ativo: z.boolean().optional(),
})

export async function GET() {
  const auth = await requireResourceViewer('regras_transporte')
  if ('error' in auth) return auth.error
  const rules = await prisma.transportTypeRule.findMany({ orderBy: { prioridade: 'asc' } })
  return NextResponse.json(rules)
}

export async function POST(req: NextRequest) {
  const auth = await requireResourceEditor('regras_transporte')
  if ('error' in auth) return auth.error
  const parsed = ruleSchema.safeParse(await req.json())
  if (!parsed.success) return badRequest(parsed.error.issues.map((i) => i.message).join('; '))

  const rule = await prisma.transportTypeRule.create({ data: parsed.data })
  await logAudit({
    userId: auth.user.id,
    userName: auth.user.name,
    action: 'CREATE',
    entity: 'TransportTypeRule',
    entityId: rule.id,
    details: parsed.data,
  })
  return NextResponse.json(rule, { status: 201 })
}
```

- [ ] **Step 2: Rota de atualização e exclusão**

Create `src/app/api/admin/transport-type-rules/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { requireResourceEditor, badRequest } from '@/lib/api-helpers'

const updateSchema = z.object({
  tipo: z.string().min(1).optional(),
  prioridade: z.number().int().optional(),
  codtmv: z.string().nullable().optional(),
  produtos: z.string().nullable().optional(),
  origemColigada: z.number().int().nullable().optional(),
  origemFilial: z.number().int().nullable().optional(),
  destinoColigada: z.number().int().nullable().optional(),
  destinoFilial: z.number().int().nullable().optional(),
  ativo: z.boolean().optional(),
})

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireResourceEditor('regras_transporte')
  if ('error' in auth) return auth.error
  const { id } = await params
  const parsed = updateSchema.safeParse(await req.json())
  if (!parsed.success) return badRequest(parsed.error.issues.map((i) => i.message).join('; '))

  const rule = await prisma.transportTypeRule.update({ where: { id }, data: parsed.data })
  await logAudit({
    userId: auth.user.id,
    userName: auth.user.name,
    action: 'UPDATE',
    entity: 'TransportTypeRule',
    entityId: id,
    details: parsed.data,
  })
  return NextResponse.json(rule)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireResourceEditor('regras_transporte')
  if ('error' in auth) return auth.error
  const { id } = await params
  await prisma.transportTypeRule.delete({ where: { id } })
  await logAudit({
    userId: auth.user.id,
    userName: auth.user.name,
    action: 'DELETE',
    entity: 'TransportTypeRule',
    entityId: id,
  })
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 3: Checagem de tipos**

Run: `npx tsc --noEmit`
Expected: sem erro.

- [ ] **Step 4: Verificação manual**

Com o servidor de dev no ar e cookie de sessão ADMIN:

```bash
curl -s -X POST http://localhost:3002/api/admin/transport-type-rules -H "Content-Type: application/json" -H "Cookie: <cookie>" -d '{"tipo":"tratamento","prioridade":0,"codtmv":"2.2.88","destinoColigada":5,"destinoFilial":3}'
curl -s http://localhost:3002/api/admin/transport-type-rules -H "Cookie: <cookie>"
```

Expected: primeiro comando cria a regra; segundo lista com a regra criada.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/transport-type-rules
git commit -m "feat: API de cadastro de regras de transporte (CRUD)"
```

---

### Task 7: Tela de cadastro — Regras de Transporte

**Files:**
- Create: `src/app/dashboard/admin/regras-transporte/page.tsx`
- Modify: `src/app/dashboard/admin/page.tsx` (adicionar contagem + card)

**Interfaces:**
- Consumes: `GET/POST /api/admin/transport-type-rules`, `PUT/DELETE /api/admin/transport-type-rules/:id` (Task 6); `TIPOS_TRANSPORTE_CONHECIDOS` (`@/lib/transporte/tipos`, Task 3); `SortableTable`.

- [ ] **Step 1: Criar a página de cadastro**

Create `src/app/dashboard/admin/regras-transporte/page.tsx`:

```tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import { SortableTable, type SortableColumn } from '@/components/shared/SortableTable'
import { TIPOS_TRANSPORTE_CONHECIDOS } from '@/lib/transporte/tipos'

interface RuleRecord {
  id: string
  tipo: string
  prioridade: number
  codtmv: string | null
  produtos: string | null
  origemColigada: number | null
  origemFilial: number | null
  destinoColigada: number | null
  destinoFilial: number | null
  ativo: boolean
}

const EMPTY = {
  tipo: '',
  prioridade: '0',
  codtmv: '',
  produtos: '',
  origemColigada: '',
  origemFilial: '',
  destinoColigada: '',
  destinoFilial: '',
  ativo: true,
}

function numOrNull(v: string): number | null {
  if (v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export default function RegrasTransportePage() {
  const [rules, setRules] = useState<RuleRecord[]>([])
  const [form, setForm] = useState(EMPTY)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/transport-type-rules')
    if (res.ok) setRules(await res.json())
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  function startEdit(r: RuleRecord) {
    setEditingId(r.id)
    setForm({
      tipo: r.tipo,
      prioridade: String(r.prioridade),
      codtmv: r.codtmv ?? '',
      produtos: r.produtos ?? '',
      origemColigada: r.origemColigada != null ? String(r.origemColigada) : '',
      origemFilial: r.origemFilial != null ? String(r.origemFilial) : '',
      destinoColigada: r.destinoColigada != null ? String(r.destinoColigada) : '',
      destinoFilial: r.destinoFilial != null ? String(r.destinoFilial) : '',
      ativo: r.ativo,
    })
    setError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const payload = {
      tipo: form.tipo,
      prioridade: Number(form.prioridade) || 0,
      codtmv: form.codtmv === '' ? null : form.codtmv,
      produtos: form.produtos === '' ? null : form.produtos,
      origemColigada: numOrNull(form.origemColigada),
      origemFilial: numOrNull(form.origemFilial),
      destinoColigada: numOrNull(form.destinoColigada),
      destinoFilial: numOrNull(form.destinoFilial),
      ativo: form.ativo,
    }
    const res = await fetch(editingId ? `/api/admin/transport-type-rules/${editingId}` : '/api/admin/transport-type-rules', {
      method: editingId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setSaving(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Falha ao salvar')
      return
    }
    setForm(EMPTY)
    setEditingId(null)
    load()
  }

  async function remove(id: string) {
    if (!confirm('Excluir esta regra?')) return
    const res = await fetch(`/api/admin/transport-type-rules/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Falha ao excluir')
      return
    }
    load()
  }

  const columns: SortableColumn<RuleRecord>[] = [
    { key: 'prioridade', label: 'Prioridade', sortValue: (r) => r.prioridade, render: (r) => r.prioridade },
    { key: 'tipo', label: 'Tipo', sortValue: (r) => r.tipo, render: (r) => <span className="font-medium">{r.tipo}</span> },
    { key: 'codtmv', label: 'CODTMV', sortValue: (r) => r.codtmv ?? '', render: (r) => r.codtmv ?? 'qualquer' },
    { key: 'produtos', label: 'Produtos', sortValue: (r) => r.produtos ?? '', render: (r) => r.produtos ?? 'qualquer' },
    {
      key: 'origem',
      label: 'Origem (coligada/filial)',
      sortValue: (r) => `${r.origemColigada ?? ''}.${r.origemFilial ?? ''}`,
      render: (r) => (r.origemColigada != null || r.origemFilial != null ? `${r.origemColigada ?? '*'}.${r.origemFilial ?? '*'}` : 'qualquer'),
    },
    {
      key: 'destino',
      label: 'Destino (coligada/filial)',
      sortValue: (r) => `${r.destinoColigada ?? ''}.${r.destinoFilial ?? ''}`,
      render: (r) => (r.destinoColigada != null || r.destinoFilial != null ? `${r.destinoColigada ?? '*'}.${r.destinoFilial ?? '*'}` : 'qualquer'),
    },
    { key: 'ativo', label: 'Situação', sortValue: (r) => (r.ativo ? 1 : 0), render: (r) => (r.ativo ? 'Ativa' : 'Inativa') },
    {
      key: 'acoes',
      label: '',
      sortValue: () => 0,
      render: (r) => (
        <span className="whitespace-nowrap">
          <button onClick={() => startEdit(r)} className="text-emerald-700 hover:underline">
            Editar
          </button>
          <button onClick={() => remove(r.id)} className="ml-3 text-red-600 hover:underline">
            Excluir
          </button>
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Regras de Transporte</h1>
        <p className="text-sm text-slate-500">
          Classifica cada movimentação do dataset de transporte interno em um tipo de negócio (venda rodoviária,
          transferência interna, madeira para carvão, madeira para tratamento). Testadas em ordem de prioridade —
          a primeira regra cujos campos preenchidos batem com a movimentação vence. Campo em branco = não filtra
          por isso.
        </p>
      </div>

      <form onSubmit={save} className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-medium">{editingId ? 'Editar regra' : 'Nova regra'}</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div>
            <label className="block text-xs font-medium text-slate-600">Tipo</label>
            <input
              required
              list="tipos-conhecidos"
              value={form.tipo}
              onChange={(e) => setForm({ ...form, tipo: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
            <datalist id="tipos-conhecidos">
              {TIPOS_TRANSPORTE_CONHECIDOS.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.label}
                </option>
              ))}
            </datalist>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Prioridade</label>
            <input
              type="number"
              value={form.prioridade}
              onChange={(e) => setForm({ ...form, prioridade: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">CODTMV (vazio = qualquer)</label>
            <input
              value={form.codtmv}
              onChange={(e) => setForm({ ...form, codtmv: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 font-mono text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Produtos (CODIGOPRD, vírgula; vazio = qualquer)</label>
            <input
              value={form.produtos}
              onChange={(e) => setForm({ ...form, produtos: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 font-mono text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Origem — coligada</label>
            <input
              type="number"
              value={form.origemColigada}
              onChange={(e) => setForm({ ...form, origemColigada: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Origem — filial</label>
            <input
              type="number"
              value={form.origemFilial}
              onChange={(e) => setForm({ ...form, origemFilial: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Destino — coligada</label>
            <input
              type="number"
              value={form.destinoColigada}
              onChange={(e) => setForm({ ...form, destinoColigada: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Destino — filial</label>
            <input
              type="number"
              value={form.destinoFilial}
              onChange={(e) => setForm({ ...form, destinoFilial: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.ativo}
              onChange={(e) => setForm({ ...form, ativo: e.target.checked })}
              className="h-3.5 w-3.5"
            />
            Ativa
          </label>
        </div>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <div className="mt-3 flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-emerald-700 px-4 py-1.5 text-sm text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            {saving ? 'Salvando…' : editingId ? 'Salvar alterações' : 'Adicionar'}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={() => {
                setEditingId(null)
                setForm(EMPTY)
              }}
              className="rounded-md border border-slate-300 px-4 py-1.5 text-sm hover:bg-slate-100"
            >
              Cancelar
            </button>
          )}
        </div>
      </form>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3 font-medium">Regras cadastradas ({rules.length})</div>
        <SortableTable columns={columns} rows={rules} rowKey={(r) => r.id} defaultSortKey="prioridade" defaultSortDir="asc" emptyMessage="Nenhuma regra cadastrada." />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Registrar o card na página de Cadastros**

Em `src/app/dashboard/admin/page.tsx`:

1. No `Promise.all`, adicionar `prisma.transportTypeRule.count()`, com a variável correspondente (ex. `regrasTransporte`).
2. No array `cardsPorRecurso`, adicionar:

```ts
    {
      resource: 'regras_transporte',
      href: '/dashboard/admin/regras-transporte',
      title: 'Regras de Transporte',
      count: regrasTransporte,
      desc: 'Classifica cada movimentação em venda rodoviária, transferência interna, madeira para carvão ou tratamento.',
    },
```

- [ ] **Step 3: Checagem de tipos**

Run: `npx tsc --noEmit`
Expected: sem erro.

- [ ] **Step 4: Verificação manual**

Acesse `/dashboard/admin/regras-transporte` logado como ADMIN, cadastre a regra de exemplo do Step 4 da Task 6 pela tela (tipo `tratamento`, CODTMV `2.2.88`, destino coligada `5` filial `3`), confirme que aparece na tabela ordenada por prioridade, edite e exclua.
Expected: as operações funcionam sem erro na tela.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/admin/regras-transporte src/app/dashboard/admin/page.tsx
git commit -m "feat: tela de cadastro de regras de transporte"
```

---

## Self-Review

**Spec coverage:**
- Seção A (`Vehicle`, `TransportTypeRule`, `LocationType.TALHAO`) → Task 1. ✓
- Seção B (dataset novo enxuto, sem tocar `fase1_vendas_transporte`) → Task 2. ✓
- Seção B.3 (resolução de destino, ponto de validação) → Task 3, `resolverDestino`, comentário explícito sobre a validação pendente. ✓
- Seção C (classificador) → Task 3. ✓
- Seção D (telas) → Tasks 5 e 7 cobrem os dois cadastros novos; a "Visão Geral da Frota" e as abas de tipo 1-4 ficam para o Plano 2, conforme declarado nos Global Constraints. ✓
- Seção E (custo ponderado no painel estratégico) → fora do escopo desta fundação, fica para o Plano 2 (junto da UI, que é onde o card de fechamento de período será renderizado). ✓ (declarado explicitamente, não esquecido)

**Placeholder scan:** nenhum "TBD"/"implementar depois" — o único ponto sinalizado como pendente de validação (`resolverDestino`, formato de `CODLOC`) tem lógica real e comportamento testável (retorna `null` quando não resolve), documentado como tal.

**Type consistency:** `TipoTransporte`/`RegraTransporte`/`MovimentoTransporteInterno` definidos uma vez em `src/lib/transporte/` (Task 3) e reutilizados sem renomear em nenhuma task seguinte; nomes de campo do Prisma (`precisaRastreamento`, `codTra`, `origemColigada` etc.) idênticos entre schema (Task 1), API (Tasks 4/6) e UI (Tasks 5/7).
