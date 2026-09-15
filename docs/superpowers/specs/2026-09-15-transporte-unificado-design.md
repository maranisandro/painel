# Transporte unificado (frota + segregação por tipo) — Design

Data: 2026-09-15
Escopo: (A) cadastro central de veículo/frota com flag de rastreamento
(Omnilink); (B) generalização do controle de transporte — hoje só
rodoviário de venda (Fase 1) — para cobrir movimentações internas da
empresa; (C) fechamento de custo médio ponderado por volume no painel
estratégico de transporte.

## Contexto e motivação

Pedido do usuário: unificar o controle de transporte hoje restrito à venda
rodoviária (Fase 1) com outros tipos de movimentação que também usam
transporte rodoviário, mas não são venda. Motivação: ter uma **visão
global da frota** (todo veículo, toda viagem, independente do negócio que
atendeu) e, a partir dela, **segregar por tipo de negócio**. "Transporte
rodoviário" deixa de ser sinônimo de "venda com transporte" e passa a ser
uma segregação entre outras.

**Tipos de transporte identificados pelo usuário** (todos rodoviários,
todos usando as mesmas tabelas TOTVS RM — `TMOV`/`TMOVCOMPL`/`TITMMOV`):

1. **Venda rodoviária** — venda de carvão, cavaco e madeira tratada.
   CODTMV `2.2.40`, `2.2.88`, `3.1.80`, `2.2.28`. Já coberto hoje pelo
   dataset `fase1_vendas_transporte` (Fase 1/Fase 5).
2. **Transferência interna de madeira** — hoje entre Felixlândia e Morada
   Nova (coligadas diferentes). CODTMV `2.2.28`.
3. **Madeira para carvão** — dos talhões para as unidades de
   carbonização. CODTMV `2.2.88`.
4. **Madeira para tratamento** — mesma CODTMV do tipo 3 (`2.2.88`);
   diferencia por produto e por destino: coligada `5`, filial `3`.

Tipos 2-4 são sempre movimentação **interna** (sem cliente externo,
sempre dentro das empresas do grupo) — diferente do tipo 1, que é venda.
O mesmo CODTMV pode aparecer em mais de um tipo (`2.2.28` e `2.2.88` estão
tanto em venda quanto em movimentação interna); o que diferencia
efetivamente é a combinação **coligada/filial de origem × destino**.

**Decisões já tomadas com o usuário:**
- Regras de classificação (CODTMV, produto, origem, destino) ficam
  **cadastradas como parâmetro**, não hardcoded em SQL nem no código —
  cadastro dedicado (`TransportTypeRule`), não o `Parameter` genérico
  (a regra tem várias dimensões, não cabe bem num campo de texto único).
- Não mexer na consulta/dataset `fase1_vendas_transporte` — Fase 1 e
  Fase 5 dependem dela como está hoje. Tipo 1 continua sendo lido de lá,
  sem duplicar extração.
- Dataset novo só para os tipos 2-4, o mais enxuto possível: reaproveita
  ao máximo nomes/lookups já resolvidos em outro lugar (produto,
  transportadora), só extrai o que ainda não existe.
- Cadastro de veículo **complementa**, não substitui, a resolução de
  transportadora que já existe (CODTRA → nome via dataset
  `dtransportadoras_rm`, bucket "Próprio"/"Outros"). O cadastro novo só
  guarda o que não existe hoje: a placa como registro central e o flag de
  rastreamento.
- Fase 1 (rodoviário de venda) vira uma aba dentro do módulo novo
  `Transporte`, reaproveitando o que já existe (composição, manutenção,
  férias, rotas) — não é reescrita, é realocação.
- Painel estratégico de transporte precisa fechar um custo médio do
  período (não só mensal), **ponderado pelo volume transportado**.

## A — Cadastro central de veículo e regras

### 1. Modelo `Vehicle`

```prisma
model Vehicle {
  id                  String   @id @default(uuid())
  placa               String   @unique
  precisaRastreamento Boolean  @default(true) @map("precisa_rastreamento")
  codTra              String?  @map("cod_tra")
  ativo               Boolean  @default(true)
  observacoes         String?
  createdAt           DateTime @default(now()) @map("created_at")
  updatedAt           DateTime @updatedAt @map("updated_at")

  @@map("vehicles")
}
```

- `placa` é a chave de negócio, mesma usada hoje solta em
  `PlateComposition`/`VehiclePosition`/`SpeedAlert`/`VehicleMaintenance`/
  `DriverVacation`/`TripTicket` — esses modelos continuam ligados por
  string por enquanto (sem FK obrigatória), para não arriscar dado/sync já
  em produção. `Vehicle` nasce como registro autoritativo consultado por
  placa; FK real fica para uma migração futura, depois de conciliar dados.
- `precisaRastreamento`: o flag pedido. `false` = caminhão sem Omnilink —
  usado para não cobrar posição/alerta de rastreamento desse veículo e não
  reportar falha de sync do Omnilink para ele.
- `codTra`: referência opcional de volta ao mundo CODTRA/transportadora já
  resolvido (nome e Próprio/Outros continuam vindo de lá — não duplicado
  aqui).
- Tela nova: `/dashboard/admin/veiculos`, mesmo padrão visual das telas
  admin existentes (cotas, rotas, produtos).

### 2. Modelo `TransportTypeRule`

```prisma
model TransportTypeRule {
  id              String   @id @default(uuid())
  tipo            String   // 'venda_rodoviaria' | 'transferencia_interna' | 'talhao_carbonizacao' | 'tratamento'
  prioridade      Int      @default(0)
  codtmv          String?  @map("codtmv")
  produtos        String?  // lista separada por vírgula, mesmo padrão de `paramList` em cotas.ts
  origemColigada  Int?     @map("origem_coligada")
  origemFilial    Int?     @map("origem_filial")
  destinoColigada Int?     @map("destino_coligada")
  destinoFilial   Int?     @map("destino_filial")
  ativo           Boolean  @default(true)
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  @@map("transport_type_rules")
}
```

- Cada campo opcional (`null`) = "não filtra por isso". Regra testada em
  ordem de `prioridade`; primeira que bater em todos os campos
  preenchidos vence.
- Tela nova: `/dashboard/admin/regras-transporte`.
- Linha sem nenhuma regra correspondente fica "não classificada" na tela
  — aparece para revisão, não desaparece silenciosamente.

### 3. Extensão do cadastro `Location`

Novo valor no enum `LocationType`: `TALHAO`, para representar a origem do
tipo 3 (talhão → unidade de carbonização). Entradas de `Location` também
passam a cobrir o mapeamento de unidades internas do grupo usadas como
"destino" das movimentações internas (ver resolução de destino abaixo).

## B — Extração de dados

### 1. Tipo 1 (venda) — sem mudança

Continua vindo de `fase1_vendas_transporte`, como hoje. Nenhuma alteração
na query nem no dataset.

### 2. Novo dataset — tipos 2-4 (movimentação interna)

Dataset novo (nome sugerido: `transporte_movimentos_internos`), mesma
base de tabelas do `fase1_vendas_transporte`
(`TMOV`/`TMOVCOMPL`/`TITMMOV`/`FCFO`/`TPRD`/`TPRDCOMPL`/`FCFOCOMPL`/
`GCONSIST`/`GFILIAL`), mas:

- `CODTMV IN ('2.2.28', '2.2.88')` — só os dois códigos usados pelos
  tipos internos (não precisa `2.2.40`/`3.1.80`, exclusivos de venda).
- **Sem filtro de produto e sem filtro de destino no SQL** — isso fica
  100% a cargo do `TransportTypeRule`, resolvido em código.
- Mesmo escopo de coligada/filial de origem que a query de venda já usa.
- Colunas mínimas — só o que ainda não existe em nenhum lugar do sistema:
  `CODCOLIGADA`/`CODFILIAL` (origem), `IDMOV`/`NUMEROMOV` (chave),
  `DATASAIDA`, `CODTMV`, `CODLOC` e `CODCFO` (candidatos a resolver
  destino — ver abaixo), `PESOBRUTO`/`PESOLIQUIDO`, `CODIGOPRD` +
  quantidade, `PLACA`/`MOTORISTA`, `CODTRA`, `RECMODIFIEDON` (sync
  incremental, replicando o padrão de `fase1_vendas_transporte`). **Não**
  re-seleciona nome de produto, nome de cliente, M3 unitário etc. — isso é
  resolvido via lookup nos dados já sincronizados (produto e transportadora
  já são resolvidos em outro lugar do sistema).
- Como `2.2.28`/`2.2.88` também são usados em venda, é esperado que essa
  extração capture de novo alguma linha que já está em
  `fase1_vendas_transporte`. Isso é aceito por design: o classificador
  rotula tudo, e a "Visão Geral da Frota" **dedupliça por `IDMOV`** contra
  `fase1_vendas_transporte` na hora de montar o rollup — uma linha que já
  é venda não conta duas vezes.

### 3. Resolução de destino — ponto de validação

`resolverDestino(linha)` tenta `CODLOC` primeiro; cai para um mapeamento
por `CODCFO` (via as novas entradas de `Location` para unidades internas
do grupo). **A validação de qual campo (`CODLOC` vs `CODCFO`) carrega o
destino de fato precisa ser feita contra dado real durante a
implementação** — não bloqueia o design, mas é o primeiro passo prático
antes de ligar o classificador em produção.

## C — Classificador

Função `classificarTipoTransporte(linha, regras: TransportTypeRule[])`,
mesmo espírito de `resolverConfigVendas`/`prepararVendas` (Fase 3) já
existente no projeto:

- Linha de `fase1_vendas_transporte` → sempre tipo 1, não passa pelo
  classificador (a própria definição do dataset já é a regra de venda).
- Linha do dataset novo → testa contra `TransportTypeRule` em ordem de
  prioridade: `codtmv` (se preenchido), `produtos` (se preenchida a
  lista), `origemColigada`/`origemFilial` (contra `TMOV.CODCOLIGADA`/
  `CODFILIAL`), `destinoColigada`/`destinoFilial` (contra o destino
  resolvido). Primeira regra que bater em tudo o que tem preenchido,
  vence.
- Sem regra correspondente → fica "não classificado", visível na tela.

## D — Estrutura da tela

Módulo novo `Transporte` (rota `/dashboard/transporte`), abas:

- **Visão Geral da Frota** (nova) — por placa, cruzando `Vehicle` com o
  dado classificado dos 4 tipos: utilização (viagens/km/dias ativo x
  parado), alertas e manutenção (reaproveita `VehiclePosition`/
  `SpeedAlert`/`VehicleMaintenance`/`DriverVacation`, hoje presos à venda,
  passam a cobrir a frota inteira), composição e capacidade atual
  (`PlateComposition`/`CompositionSpec`), custo consolidado somando os 4
  tipos por veículo.
- **Venda rodoviária** = a Fase 1 de hoje, realocada como aba, sem mudança
  de dado.
- **Transferência interna**, **Talhão→Carbonização**, **Madeira→
  Tratamento** = telas novas, mais simples (sem conceito de venda/cliente/
  preço), construídas em cima do dataset novo já classificado.

## E — Custo médio do período ponderado por volume

**Achado da investigação**: o painel tático (`Fase1Dashboard.tsx`) já
calcula `custoPorKm`/`custoPorTonelada` corretamente como soma do custo do
período ÷ soma do volume do período (ponderado, não é bug). O **painel
estratégico** (`Fase1Estrategico.tsx`) calcula `custoPorKm`/
`custoPorTonelada` corretamente **por mês**, mas nunca fecha um total/
médio do período selecionado — só renderiza a série mensal (gráfico e
tabela), sem uma linha ou card de "período inteiro". É essa lacuna que o
usuário está apontando ("tem os valores mensais mas ele não fecha os
custos médios do período").

**Regra para o fechamento do período** (vale para o painel estratégico da
aba de venda e para as 3 abas novas): o custo médio do período **NUNCA**
é a média aritmética dos custos médios mensais — é sempre:

```
custoPorKmPeriodo = soma(custoTotal de cada mês do período) / soma(kmTotal de cada mês do período)
custoPorToneladaPeriodo = soma(custoTotal de cada mês do período) / soma(pesoTotal de cada mês do período)
```

ou seja, ponderado pelo volume transportado de cada mês — meses com mais
volume pesam mais no período, exatamente como o painel tático já faz.
Isso vira uma linha/card de fechamento no painel estratégico (de cada
aba do módulo Transporte), além da série mensal que já existe.

## Fora de escopo desta spec

- FK obrigatória de `Vehicle` para os cadastros existentes por placa —
  fica para uma migração futura, depois de conciliar dado.
- Suporte a modais de transporte não-rodoviários (ferroviário, marítimo)
  — não existe hoje, fora do escopo pedido.
- Reescrita da Fase 1 — só realocação como aba dentro do módulo novo.
