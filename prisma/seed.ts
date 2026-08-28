import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
})

// Consulta de origem do painel Power BI de Transporte Rodoviário (ver nota
// "Fase1 - Transporte Rodoviário" no Obsidian). Adaptações em relação ao
// original: TPRD.NOMEFANTASIA ganhou alias PRODUTO (equivale à etapa
// "Colunas Renomeadas" do PowerQuery e evita colisão com FCFO.NOMEFANTASIA);
// o filtro fixo de DATASAIDA permanece como carga inicial — depois disso a
// sincronização incremental usa a marca d'água sobre DATASAIDA.
const QUERY_FASE1_VENDAS = `
SELECT
TMOV.CODCOLIGADA,
TMOV.CODFILIAL,
TMOV.IDMOV,
TMOV.CODCOLIGADA||TMOV.CODFILIAL FK_FILIAL,
TMOV.CODCOLIGADA||TMOV.CODFILIAL||LTrim(TMOV.NUMEROMOV,0) FK_COLIGADA,
TMOV.CODLOC,
TMOV.DATASAIDA,
FCFO.CODETD,
FCFO.CIDADE,
TMOV.CODCFO,
TMOV.CODCCUSTO,
FCFO.NOMEFANTASIA,
TMOV.NUMEROMOV,
TPRD.CODIGOPRD,
TPRD.NOMEFANTASIA PRODUTO,
CASE
 WHEN TMOV.CODTMV IN ('1.2.83','1.2.84') THEN TITMMOV.QUANTIDADE *-1
 ELSE TITMMOV.QUANTIDADE
END QUANTIDADE,
TITMMOV.PRECOUNITARIO,
CASE
 WHEN TMOV.CODTMV IN ('1.2.83','1.2.84') THEN ((TITMMOV.PRECOUNITARIO * TITMMOV.QUANTIDADE) - NVL(TITMMOV.VALORDESC,0))*-1
 ELSE (TITMMOV.PRECOUNITARIO * TITMMOV.QUANTIDADE) - NVL(TITMMOV.VALORDESC,0)
END VALOR,
TITMMOV.VALORDESC DESCONTO,
TPRDCOMPL.M3 M3_UNITARIO,
ROUND(TITMMOV.QUANTIDADE * TPRDCOMPL.M3,4) M3_TOTAL,
ROUND(TITMMOV.PRECOUNITARIO/TPRDCOMPL.M3,4) VALOR_M3,
GCONSIST.CODCLIENTE CODVINC,
GCONSIST.DESCRICAO VINCULO,
TMOV.CODTMV,
TMOV.PESOBRUTO,
TMOV.PESOLIQUIDO,
TITMMOV.CODUND,
TMOV.CODTRA,
TMOVCOMPL.PLACA,
TMOVCOMPL.MOTORISTA,
NVL(GFILIAL.NOMEFANTASIA, GFILIAL.NOME) NOME_FILIAL,
GREATEST(NVL(TMOV.RECMODIFIEDON,TMOV.RECCREATEDON), NVL(TITMMOV.RECMODIFIEDON,TITMMOV.RECCREATEDON)) RECMODIFIEDON
FROM    RM.TMOV,RM.TMOVCOMPL, RM.TITMMOV, RM.FCFO, RM.TPRD, RM.TPRDCOMPL, RM.TPRODUTODEF, RM.GFILIAL, RM.FCFOCOMPL LEFT JOIN RM.GCONSIST
ON       FCFOCOMPL.CODCOLIGADA = GCONSIST.CODCOLIGADA
AND      FCFOCOMPL.CLIENTE = GCONSIST.CODCLIENTE
AND      GCONSIST.APLICACAO = 'T'
AND      GCONSIST.CODTABELA = 'CLIENTE'
WHERE   TMOV.CODCOLIGADA = TITMMOV.CODCOLIGADA
AND     TMOV.IDMOV = TITMMOV.IDMOV
AND     TMOV.CODCOLIGADA = FCFO.CODCOLIGADA
AND     TMOV.CODCFO = FCFO.CODCFO
AND     TITMMOV.CODCOLIGADA = TPRD.CODCOLIGADA
AND     TITMMOV.IDPRD = TPRD.IDPRD
AND     TPRD.CODCOLIGADA = TPRDCOMPL.CODCOLIGADA
AND     TPRD.IDPRD = TPRDCOMPL.IDPRD
AND     FCFO.CODCOLIGADA = FCFOCOMPL.CODCOLIGADA
AND     FCFO.CODCFO = FCFOCOMPL.CODCFO
AND     TMOV.IDMOV = TMOVCOMPL.IDMOV
AND     TMOV.CODCOLIGADA = TMOVCOMPL.CODCOLIGADA
AND     TPRODUTODEF.IDPRD = TPRD.IDPRD
AND     TPRODUTODEF.CODCOLIGADA = TPRD.CODCOLIGADA
AND     GFILIAL.CODCOLIGADA = TMOV.CODCOLIGADA
AND     GFILIAL.CODFILIAL = TMOV.CODFILIAL
AND (
     (TMOV.CODCOLIGADA = 5 AND TMOV.CODFILIAL IN (3,4,6,11,12,13))
  OR (TMOV.CODCOLIGADA = 6 AND TMOV.CODFILIAL IN (3,4,6,7,8,9,10,11,12))
  OR (TMOV.CODCOLIGADA = 28 AND TMOV.CODFILIAL IN (4,5,6))
  OR (TMOV.CODCOLIGADA = 33 AND TMOV.CODFILIAL IN (1))
  OR (TMOV.CODCOLIGADA = 34 AND TMOV.CODFILIAL IN (1))
  )
AND TMOV.CODTMV IN ( '2.2.40', '2.2.88','3.1.80','2.2.28')
AND TPRD.CODIGOPRD  IN ('42.57.000002', '91.09.000001' ,'91.09.000002','91.09.000006','42.59.000001','95.10.000012','95.10.000002','42.56.000001','42.56.000002','42.56.000003', '42.56.000027','42.56.000025')
AND TMOV.STATUS <> 'C'
AND TMOV.DATASAIDA >= TO_DATE('01/01/2026', 'DD/MM/YYYY')
`.trim()

// Consulta de origem do painel Power BI "Planep_Faturamento_New" (Fase 3 —
// Produção e Venda de Madeira Tratada), tabela FaturamentoNovo. Migrado da
// query ativa (2022 em diante) do arquivo .SemanticModel; a query anterior
// (2016-2020, comentada no original) ficou de fora. DISTRIBUIDOR vem de um
// segundo join em RM.GCONSIST (CODTABELA='DISTRIBUID'), igual à consulta
// D_CLIENTES do mesmo relatório.
// Exclusão de Carvão/Cavaco (pedido do usuário 2026-08-04: "este painel não
// deve trazer carvão nem cavaco, pode desprezar estes produtos, somente
// madeira tratada AMARU, SERRAGEM, MARAVALHA, PERFIL, MOURAO, PECAS") —
// a faixa ampla de CODIGOPRD (42.00.000001–95.99.999999) da query original
// também trazia CARVAO VEGETAL (42.57.000002), CAVACO/RESIDUO DE CAVACO
// (42.59.x), LENHA PARA CARVÃO/CAVACO (42.56.000025/027), COMPLEMENTO DE
// PREÇO CARVAO (91.09.000002) e dois subprodutos sem relação com madeira
// tratada (ALCATRÃO VEGETAL 42.02.000007, COAGULO-LATEX 42.58.000001) —
// esses são de Fase 2 (Carvão) e Fase 4 (Cavaco), fora de escopo aqui.
// Filtrado por NOME em vez de faixa de código (mais robusto a novos SKUs
// de carvão/cavaco que a Oracle possa cadastrar depois).
// PRECO_MEDIO_TABELA4 (pedido do usuário 2026-08-03: "o valor de bonificação
// é a diferença do preço de venda para o preço tabela 4") — duas subqueries
// correlacionadas contra RM.TTABPRECO/TTABPRECOCFO/TTABPRECOPRD: se existir
// uma tabela de preço "DISTRIBUIDOR%" vigente na data da venda para
// aquele cliente/produto, usa o preço dela; senão cai no próprio
// PRECOUNITARIO (bonificação sem tabela de distribuidor = sem diferença a
// apurar). Não precisa de TPRODUTODEF/PRECO1-3 — isso só existia na query
// antiga (2016-2020), já fora do recorte.
const QUERY_FASE3_VENDAS_MADEIRA = `
SELECT
TMOV.CODCOLIGADA,
TMOV.CODFILIAL,
TMOV.IDMOV,
TITMMOV.NSEQITMMOV,
TMOV.DATASAIDA,
TMOV.NUMEROMOV,
TMOV.CODCFO,
FCFO.CODETD,
FCFO.CIDADE,
FCFO.NOMEFANTASIA CLIENTE,
FCFOCOMPL.DISTRIBUIDOR CODDISTRIBUIDOR,
DISTRIBUIDOR.DESCRICAO DISTRIBUIDOR,
TPRD.CODIGOPRD,
TPRD.NOMEFANTASIA PRODUTO,
TITMMOV.QUANTIDADE,
TITMMOV.PRECOUNITARIO PRECO_VENDIDO,
TITMMOV.PRECOUNITARIO * TITMMOV.QUANTIDADE - NVL(TITMMOV.VALORDESC,0) VALOR,
TITMMOV.VALORDESC DESCONTO,
TPRDCOMPL.M3 M3_UNITARIO,
CASE
  WHEN TPRD.CODIGOPRD = '95.10.000013' THEN ROUND((TITMMOV.QUANTIDADE) / 4, 4)
  WHEN TPRD.CODIGOPRD = '95.10.000012' THEN ROUND((TITMMOV.QUANTIDADE), 4)
  ELSE ROUND(TITMMOV.QUANTIDADE * TPRDCOMPL.M3, 4)
END M3_TOTAL,
ROUND(TITMMOV.PRECOUNITARIO/TPRDCOMPL.M3,4) VALOR_M3,
CASE
  WHEN FCFO.CODETD IN ('AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MT','MS','PA','PB','PE','PI','RN','RO','RR','SE','TO') THEN 'ICMS 7%'
  WHEN FCFO.CODETD IN ('PR','RS','RJ','SC','SP') THEN 'ICMS 12%'
  WHEN FCFO.CODETD IN ('MG') THEN 'ICMS 18%'
END TABELA_PRECO,
CASE
  WHEN TMOVCOMPL.BONIFICACAO = 1 THEN 'SIM'
  ELSE 'NAO'
END BONIFICACAO,
CASE
  WHEN (SELECT TTABPRECO.NOME
        FROM RM.TTABPRECO, RM.TTABPRECOCFO, RM.TTABPRECOPRD
        WHERE TTABPRECO.CODCOLIGADA = TMOV.CODCOLIGADA
        AND   TTABPRECO.DATAVIGENCIAINI <= TMOV.DATASAIDA
        AND   TTABPRECO.DATAVIGENCIAFIM >= TMOV.DATASAIDA
        AND   TTABPRECO.CODCOLIGADA = TTABPRECOCFO.CODCOLIGADA
        AND   TTABPRECO.IDTABPRECO  = TTABPRECOCFO.IDTABPRECO
        AND   TTABPRECOCFO.CODCFO = TMOV.CODCFO
        AND   TTABPRECO.CODCOLIGADA = TTABPRECOPRD.CODCOLIGADA
        AND   TTABPRECO.IDTABPRECO  = TTABPRECOPRD.IDTABPRECO
        AND   TTABPRECOPRD.IDPRD = TPRD.IDPRD
        AND   TTABPRECO.NOME LIKE 'DISTRIBUIDOR%'
        AND   ROWNUM = 1) IS NOT NULL
  THEN (SELECT TTABPRECOPRD.PRECO
        FROM RM.TTABPRECO, RM.TTABPRECOCFO, RM.TTABPRECOPRD
        WHERE TTABPRECO.CODCOLIGADA = TMOV.CODCOLIGADA
        AND   TTABPRECO.DATAVIGENCIAINI <= TMOV.DATASAIDA
        AND   TTABPRECO.DATAVIGENCIAFIM >= TMOV.DATASAIDA
        AND   TTABPRECO.CODCOLIGADA = TTABPRECOCFO.CODCOLIGADA
        AND   TTABPRECO.IDTABPRECO  = TTABPRECOCFO.IDTABPRECO
        AND   TTABPRECOCFO.CODCFO = TMOV.CODCFO
        AND   TTABPRECO.CODCOLIGADA = TTABPRECOPRD.CODCOLIGADA
        AND   TTABPRECO.IDTABPRECO  = TTABPRECOPRD.IDTABPRECO
        AND   TTABPRECOPRD.IDPRD = TPRD.IDPRD
        AND   TTABPRECO.NOME LIKE 'DISTRIBUIDOR%'
        AND   ROWNUM = 1)
  ELSE TITMMOV.PRECOUNITARIO
END PRECO_MEDIO_TABELA4,
TMOV.CODTMV,
TMOVCOMPL.PLACA,
GREATEST(NVL(TMOV.RECMODIFIEDON,TMOV.RECCREATEDON), NVL(TITMMOV.RECMODIFIEDON,TITMMOV.RECCREATEDON)) RECMODIFIEDON
FROM RM.TMOV, RM.TITMMOV, RM.TMOVCOMPL, RM.FCFO, RM.TPRD, RM.TPRDCOMPL, RM.FCFOCOMPL
LEFT JOIN RM.GCONSIST DISTRIBUIDOR
ON       FCFOCOMPL.CODCOLIGADA = DISTRIBUIDOR.CODCOLIGADA
AND      FCFOCOMPL.DISTRIBUIDOR = DISTRIBUIDOR.CODCLIENTE
AND      DISTRIBUIDOR.APLICACAO = 'T'
AND      DISTRIBUIDOR.CODTABELA = 'DISTRIBUID'
WHERE   TMOV.CODCOLIGADA = TITMMOV.CODCOLIGADA
AND     TMOV.IDMOV = TITMMOV.IDMOV
AND     TMOV.CODCOLIGADA = TMOVCOMPL.CODCOLIGADA
AND     TMOV.IDMOV = TMOVCOMPL.IDMOV
AND     TMOV.CODCOLIGADA = FCFO.CODCOLIGADA
AND     TMOV.CODCFO = FCFO.CODCFO
AND     TITMMOV.CODCOLIGADA = TPRD.CODCOLIGADA
AND     TITMMOV.IDPRD = TPRD.IDPRD
AND     TPRD.CODCOLIGADA = TPRDCOMPL.CODCOLIGADA
AND     TPRD.IDPRD = TPRDCOMPL.IDPRD
AND     FCFO.CODCOLIGADA = FCFOCOMPL.CODCOLIGADA
AND     FCFO.CODCFO = FCFOCOMPL.CODCFO
AND     TMOV.CODCOLIGADA = 5
AND     TMOV.CODTMV IN ('2.2.40','2.2.44','2.2.45','2.2.48','2.2.55','2.2.01','2.2.02','2.2.05','2.2.10','2.2.12','2.2.15','2.2.65','2.2.07','2.2.08','1.2.83','1.2.84','2.2.41')
AND     TPRD.CODIGOPRD BETWEEN '42.00.000001' AND '95.99.999999'
AND     TPRD.CODIGOPRD <> '95.02.050001'
AND     TPRD.CODIGOPRD NOT LIKE '60.%'
AND     TPRD.CODIGOPRD NOT LIKE '90.%'
AND     TMOV.STATUS <> 'C'
AND     TMOV.DATASAIDA >= TO_DATE('01/01/2022', 'DD/MM/YYYY')
AND     UPPER(TPRD.NOMEFANTASIA) NOT LIKE '%CARV%'
AND     UPPER(TPRD.NOMEFANTASIA) NOT LIKE '%CAVACO%'
AND     UPPER(TPRD.NOMEFANTASIA) NOT LIKE '%ALCATR%'
AND     UPPER(TPRD.NOMEFANTASIA) NOT LIKE '%LATEX%'
`.trim()

// Cadastro de clientes (D_CLIENTES no Power BI "Planep_Faturamento_New") —
// colado pelo usuário na nota Fase 3 em 2026-08-04 ("acertarmos os
// distribuidores, pois esta incorreto" + base para a aba de clientes
// inativos/prospecção, que precisa de e-mail/telefone para contato). Mesmo
// JOIN de DISTRIBUIDOR (RM.GCONSIST, CODTABELA='DISTRIBUID') da query de
// vendas — ABREV_DISTRIBUIDOR usa a mesma cascata de texto, então serve para
// conferir se o distribuidor de um cliente bate entre as duas fontes.
// Omitidas as subqueries financeiras do original (VALORES_ABERTO,
// PEDIDOS_PENDENTES, LIMITE_DISPONIVEL) e VINCULO — não usadas em nenhuma
// análise da Fase 3, só custo extra de consulta.
const QUERY_FASE3_CLIENTES = `
SELECT
CLIENTE.CODCFO,
CLIENTE.NOMEFANTASIA CLIENTE,
FCFOCOMPL.DISTRIBUIDOR CODDISTRIBUIDOR,
DISTRIBUIDOR.DESCRICAO DISTRIBUIDOR,
CLIENTE.EMAIL,
CLIENTE.CONTATO,
CLIENTE.CODETD,
CLIENTE.CIDADE,
CLIENTE.TELEFONE,
CLIENTE.TELEX CELULAR,
CLIENTE.RECCREATEDON,
GREATEST(NVL(CLIENTE.RECMODIFIEDON,CLIENTE.RECCREATEDON), NVL(FCFOCOMPL.RECMODIFIEDON,FCFOCOMPL.RECCREATEDON)) RECMODIFIEDON
FROM RM.FCFO CLIENTE, RM.FCFOCOMPL
LEFT JOIN RM.GCONSIST DISTRIBUIDOR
ON       FCFOCOMPL.CODCOLIGADA = DISTRIBUIDOR.CODCOLIGADA
AND      FCFOCOMPL.DISTRIBUIDOR = DISTRIBUIDOR.CODCLIENTE
AND      DISTRIBUIDOR.APLICACAO = 'T'
AND      DISTRIBUIDOR.CODTABELA = 'DISTRIBUID'
WHERE   CLIENTE.CODCOLIGADA = 5
AND     CLIENTE.CODCOLIGADA = FCFOCOMPL.CODCOLIGADA
AND     CLIENTE.CODCFO = FCFOCOMPL.CODCFO
`.trim()

// Cadastro de transportadoras (dTransportadorasRM no Power BI). Adaptações
// em relação ao PowerQuery: o filtro de coligadas virou WHERE e a correção
// "VIANA & MATOS LTDA" -> "VIANA E MATOS LTDA" virou REPLACE no SQL.
const QUERY_TRANSPORTADORAS = `
SELECT CODCOLIGADA, CODTRA, REPLACE(NOME, 'VIANA & MATOS LTDA', 'VIANA E MATOS LTDA') NOME, NVL(RECMODIFIEDON, RECCREATEDON) RECMODIFIEDON
FROM RM.TTRA
WHERE CODCOLIGADA IN (2, 3, 5, 6, 28, 33, 34)
`.trim()

// Controle de consumo de combustível (Officium/MySQL) — pedido do usuário
// 2026-07-25 (nota "Acompanhamento consumo de combustível" no Obsidian).
// Adaptações em relação ao PowerQuery original:
//  - JOIN direto com `objects` (mesma base MySQL) para já trazer a placa
//    (campo `code`, com fallback em `oldcode` quando `code` vem vazio) —
//    pedido explícito do usuário, em vez do LOOKUP em `dObjetos` separado.
//  - `supply_id`/`supply_updated_at` aliados explicitamente: confirmado ao
//    vivo (information_schema) que as 4 tabelas têm `id`/`created_at`/
//    `updated_at` homônimos — sem apelido, o driver ficaria com a última
//    coluna repetida (de outra tabela), não a da própria nota de
//    abastecimento. supply_updated_at usa COALESCE(updated_at, created_at):
//    confirmado ao vivo que `updated_at` só é preenchido em ~42% das notas
//    (só quando a nota é editada depois de criada) — usar só updated_at
//    faria o incremental nunca buscar notas novas que nunca foram editadas.
//  - Os demais `JOIN`s do PowerQuery (dCentroCusto, fmovRMAbastecimento,
//    fPersonProviders, dPessoas) são só para nomes amigáveis (fornecedor,
//    centro de custo) — não entram aqui porque não são necessários para o
//    cálculo de km/l; podem ser adicionados depois se o usuário precisar
//    desses detalhes no painel.
//  - `PRODUTO_ABASTECIMENTO` (pedido do usuário 2026-07-30, "não quero o
//    produto da venda e sim o produto que retorna na consulta de
//    abastecimento"): LEFT JOIN em `products` por `product_id` — é o
//    combustível/insumo do abastecimento em si (Diesel S10, Diesel comum,
//    Gasolina, Arla32, Etanol, lubrificante…), nada a ver com o produto
//    transportado na venda (carvão/cavaco/madeira). Nome do campo com
//    sufixo `_ABASTECIMENTO` de propósito, para nunca confundir com o
//    `PRODUTO` da venda (`fase1_vendas_transporte`) em nenhum lugar do
//    código. **Achado ao consultar os dados reais**: os abastecimentos
//    incluem também Arla32 e lubrificante, não só diesel — hoje o
//    `calcularConsumo` (`src/lib/fase1/fuel.ts`) soma os litros de TODOS os
//    produtos no total de litros usado no km/l, o que pode distorcer um
//    pouco a conta (Arla32 não é combustível). Não filtrado ainda — decisão
//    do usuário pendente (ver "Decisões pendentes" no Obsidian).
//  - SEM wildcards `.*`: só `date`/`pedometer`/`amount` (todos em
//    object_note_fuel_supplies, confirmado no information_schema), `PLACA` e
//    agora `PRODUTO_ABASTECIMENTO` são de fato consumidos
//    (`src/lib/fase1/fuel.ts`, `src/app/api/fase1/data/route.ts`). Bug
//    2026-07-30: com `.*` nas 3 tabelas (que compartilham
//    id/created_at/updated_at), a 1ª sincronização (sem marca d'água ainda)
//    passou porque um SELECT simples no MySQL tolera nomes de coluna
//    repetidos — mas a sincronização incremental envolve a consulta numa
//    subconsulta (`wrapIncremental`, `SELECT * FROM (consulta) W_INC WHERE
//    ...`), e uma derived table no MySQL exige nomes de coluna ÚNICOS,
//    gerando "Duplicate column name 'id'" em toda sincronização seguinte.
//    Selecionar só o que é usado elimina a colisão em vez de só empurrá-la
//    para outra coluna.
const QUERY_ABASTECIMENTO = `
SELECT
  object_note_fuel_supplies.id AS supply_id,
  COALESCE(object_note_fuel_supplies.updated_at, object_note_fuel_supplies.created_at) AS supply_updated_at,
  object_note_fuel_supplies.date AS date,
  object_note_fuel_supplies.pedometer AS pedometer,
  object_note_fuel_supplies.amount AS amount,
  products.product AS PRODUTO_ABASTECIMENTO,
  COALESCE(NULLIF(objects.code, ''), objects.oldcode) AS PLACA
FROM object_note_fuel_supplies
JOIN object_note_fuel_supply_integrations
  ON object_note_fuel_supplies.id = object_note_fuel_supply_integrations.note_fuel_supply_id
JOIN result_centers
  ON object_note_fuel_supplies.result_center_id = result_centers.id
LEFT JOIN objects
  ON object_note_fuel_supplies.object_id = objects.id
LEFT JOIN products
  ON object_note_fuel_supplies.product_id = products.id
WHERE object_note_fuel_supplies.date >= '2026-01-01 00:00:00'
`.trim()

const PLACAS_RODOTREM = [
  'SES5B33', 'SES5B34', 'SES9H22', 'SES9H23',
  'PYL5J32', 'QNL7B65', 'QOB9B01', 'RHG9E93', 'RTA2D17', 'RVD0F9', 'RVD0F97', 'RVG1I43', 'RVG1I72', 'SDW2C14', 'SDZ3E39',
  'SEW9C14', 'TAK5C09', 'TAK5C10', 'TAK5C11', 'TAK5C12', 'TAK5C13', 'TAK5C15', 'TAN0J59', 'TAU8D58', 'TBA3J98', 'TBA4A12',
  'TBH2B95', 'TBH2B96', 'TBH2B97', 'TBH2B99', 'TBH2C10', 'TBH2C16', 'TBH2C21', 'TBH2C30', 'RHO0E27', 'RHW2F52', 'SDW9C14',
  'SEO0B48', 'TBH2C08', 'TBH2C31',
]

const PLACAS_LS4 = [
  'RVG1I92', 'TAK5C10', 'TAK5C11', 'TAK5C13', 'TAO6C01',
  'TAN0J58', 'TAN0J59', 'TBA3J98', 'TBH2B95', 'TBH2B96',
  'TBH2B97', 'TBH2B98', 'TBH2B99', 'TBH2C01', 'TBH2C02',
  'TBH2C04', 'TBH2C08', 'TBH2C10', 'TBH2C14', 'TBH2C16',
  'TBH2C18', 'TBH2C19', 'TBH2C21', 'TBH2C23', 'TBH2C30',
  'TBH2C31', 'TBH2C32', 'RHX5D97',
]

async function main() {
  // --- Usuário administrador padrão ---
  // Sem senha fixa no código (correção de segurança 2026-07-25): a senha
  // inicial vem de INITIAL_ADMIN_PASSWORD (.env, nunca commitado) e só é
  // usada na PRIMEIRA criação — reexecutar o seed nunca troca a senha de um
  // admin já existente. O usuário é forçado a trocar a senha no primeiro
  // login (mustChangePassword).
  const existingAdmin = await prisma.user.findUnique({ where: { email: 'admin@grupoplantar.com.br' } })
  if (!existingAdmin) {
    const initialPassword = process.env.INITIAL_ADMIN_PASSWORD
    if (!initialPassword || initialPassword.length < 10) {
      throw new Error(
        'INITIAL_ADMIN_PASSWORD ausente ou curta (.env) — defina uma senha com pelo menos 10 caracteres antes de rodar o seed.',
      )
    }
    const passwordHash = await bcrypt.hash(initialPassword, 10)
    await prisma.user.create({
      data: {
        email: 'admin@grupoplantar.com.br',
        password: passwordHash,
        name: 'Administrador',
        role: 'ADMIN',
        mustChangePassword: true,
      },
    })
  }

  // --- Módulos (fases de negócio) ---
  const modules: { code: string; name: string; phase: number; active: boolean }[] = [
    { code: 'fase1', name: 'Transporte Rodoviário', phase: 1, active: true },
    { code: 'fase2', name: 'Produção e Venda de Carvão Vegetal', phase: 2, active: false },
    // Fase 3 iniciada 2026-08-03 (pedido do usuário: "ler o obsidian a fase 3
    // e iniciar o desenvolvimento" — perdas em valor de venda de madeira
    // tratada, comparado a um preço mínimo ponderado por ICMS/tipo produto).
    { code: 'fase3', name: 'Produção e Venda de Madeira Tratada', phase: 3, active: true },
    { code: 'fase4', name: 'Produção e Venda de Cavaco', phase: 4, active: false },
    { code: 'fase5', name: 'Transporte Interno de Madeira', phase: 5, active: false },
    // "rh" não é uma das 5 fases de negócio (produção/venda) — é módulo
    // transversal de Recursos Humanos, pedido do usuário 2026-08-13. `phase:
    // 6` só serve para ordenar depois das fases; a UI trata code sem prefixo
    // "fase" como módulo comum, sem o rótulo "Fase N" (ver dashboard/page.tsx).
    { code: 'rh', name: 'Recursos Humanos', phase: 6, active: true },
    // Idem "rh": módulo transversal (não é fase de negócio produção/venda) —
    // pedido do usuário 2026-08-27, análise de abastecimento/consumo sobre
    // TODO o universo de equipamentos (não só a frota de transporte da Fase
    // 1). `active: false` até o desenvolvimento ficar pronto pra revisão.
    { code: 'abastecimento', name: 'Abastecimento', phase: 7, active: false },
  ]
  for (const m of modules) {
    // `active` também precisa sincronizar no update — antes só atualizava o
    // nome, então ativar uma fase exigia editar o banco na mão além do seed.
    await prisma.module.upsert({ where: { code: m.code }, update: { name: m.name, active: m.active }, create: m })
  }

  // --- Telas de Cadastro (acesso granular, pedido do usuário 2026-08-14) ---
  // Antes de existir isto, todas essas telas compartilhavam um único gate
  // (admin ou editor do módulo fase1 inteiro — ver requireEditor() em
  // api-helpers.ts). Cada uma vira um AdminResource concedível separadamente
  // via Cadastros → Usuários (mesmo padrão de checkbox já usado pra módulo).
  const adminResources: { code: string; name: string; position: number }[] = [
    { code: 'locais', name: 'Locais', position: 1 },
    { code: 'rotas', name: 'Rotas', position: 2 },
    { code: 'parametros', name: 'Parâmetros', position: 3 },
    { code: 'composicoes', name: 'Composições', position: 4 },
    { code: 'produtos', name: 'Produtos', position: 5 },
    { code: 'precos_frete', name: 'Preços de frete', position: 6 },
    { code: 'manutencao', name: 'Manutenção', position: 7 },
    { code: 'ferias', name: 'Férias', position: 8 },
    { code: 'tickets_viagem', name: 'Tickets de viagem', position: 9 },
  ]
  for (const r of adminResources) {
    await prisma.adminResource.upsert({ where: { code: r.code }, update: { name: r.name, position: r.position }, create: r })
  }

  // --- Parâmetros e fórmulas (Fase 1) ---
  // Custo do transporte por MÊS (correção do usuário 2026-07-25: "o custo é
  // mensal, preciso digitar um valor por mês, não é o mesmo" — um parâmetro
  // fixo único não serve, cada mês precisa do seu próprio valor). Código
  // CUSTO_MES_<AAAAMM>, ex.: CUSTO_MES_202607. Sem parâmetro para um mês, o
  // custo desse mês é 0. Semeia só o mês corrente como ponto de partida —
  // fase futura busca do financeiro automaticamente.
  const agora = new Date()
  const mesCorrenteCode = `CUSTO_MES_${agora.getFullYear()}${String(agora.getMonth() + 1).padStart(2, '0')}`
  await prisma.parameter.upsert({
    where: { code: mesCorrenteCode },
    update: {},
    create: {
      code: mesCorrenteCode,
      name: `Custo do transporte — ${String(agora.getMonth() + 1).padStart(2, '0')}/${agora.getFullYear()} (R$)`,
      valueNumber: 0,
      description:
        'Custo total do transporte NESTE mês (combustível, manutenção, motorista, etc.), para dividir por KM rodado ou tonelada transportada. Um parâmetro por mês (CUSTO_MES_AAAAMM) — crie um novo a cada virada de mês.',
    },
  })
  await prisma.parameter.upsert({
    where: { code: 'META_KM_MES' },
    update: {},
    create: {
      code: 'META_KM_MES',
      name: 'Meta de rodagem mensal por caminhão (km)',
      valueNumber: 8000,
      description: 'Meta de KM rodados por caminhão no mês (Fase 1 — Transporte Rodoviário).',
    },
  })
  await prisma.parameter.upsert({
    where: { code: 'RITMO_KM' },
    update: {},
    create: {
      code: 'RITMO_KM',
      name: 'Ritmo de rodagem esperado até hoje (km)',
      formula: 'META_KM_MES / diasDoMes * diaDoMes',
      description: 'Quanto o caminhão deveria ter rodado até o dia atual para cumprir a meta do mês.',
    },
  })
  await prisma.parameter.upsert({
    where: { code: 'META_CONSUMO_KM_L' },
    update: {},
    create: {
      code: 'META_CONSUMO_KM_L',
      name: 'Meta de consumo da frota (km/l)',
      valueNumber: 2,
      description:
        'Meta de km rodado por litro de combustível (controle de abastecimento, Officium). Calculado pelo hodômetro entre abastecimentos consecutivos da mesma placa.',
    },
  })
  // Meta de km/mês por composição (sugestão do usuário 2026-07-25): cada
  // implemento pode ter meta própria em vez da meta única da frota. Código
  // segue META_KM_<COMPOSIÇÃO SEM ACENTO/ESPAÇO> (ver metaParamCode em
  // src/app/api/fase1/data/route.ts). Todas nascem iguais à meta global —
  // o usuário ajusta pela tela de Parâmetros conforme achar necessário.
  const metasPorComposicao: { code: string; composicao: string }[] = [
    { code: 'META_KM_LS_3_EIXOS', composicao: 'LS 3 Eixos' },
    { code: 'META_KM_LS_4_EIXOS', composicao: 'LS 4 Eixos' },
    { code: 'META_KM_RODOTREM', composicao: 'RodoTrem' },
    { code: 'META_KM_BITREM', composicao: 'BiTrem' },
    { code: 'META_KM_TRITREM_FLORESTAL', composicao: 'Tritrem Florestal' },
  ]
  for (const m of metasPorComposicao) {
    await prisma.parameter.upsert({
      where: { code: m.code },
      update: {},
      create: {
        code: m.code,
        name: `Meta de rodagem mensal — ${m.composicao} (km)`,
        valueNumber: 8000,
        description: `Meta de KM/mês específica da composição "${m.composicao}". Sem este parâmetro, a placa usaria a meta global (META_KM_MES).`,
      },
    })
  }

  // Padrões usados quando a rota ainda não tem velocidade/tempo preenchidos
  const defaults: { code: string; name: string; value: number; description: string }[] = [
    { code: 'VEL_CHEIO_PADRAO', name: 'Velocidade padrão carregado (km/h)', value: 60, description: 'Usada quando a rota não tem velocidade cheio preenchida.' },
    { code: 'VEL_VAZIO_PADRAO', name: 'Velocidade padrão vazio (km/h)', value: 75, description: 'Usada quando a rota não tem velocidade vazio preenchida.' },
    { code: 'TEMPO_CARGA_PADRAO', name: 'Tempo padrão de carga (min)', value: 90, description: 'Usado quando a rota não tem tempo de carga preenchido.' },
    { code: 'TEMPO_DESCARGA_PADRAO', name: 'Tempo padrão de descarga (min)', value: 90, description: 'Usado quando a rota não tem tempo de descarga preenchido.' },
  ]
  for (const d of defaults) {
    await prisma.parameter.upsert({
      where: { code: d.code },
      update: {},
      create: { code: d.code, name: d.name, valueNumber: d.value, description: d.description },
    })
  }

  // --- Fonte de dados Oracle TOTVS RM ---
  const oracle = await prisma.dataSource.upsert({
    where: { id: '00000000-0000-0000-0000-00000000dbprd' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-00000000dbprd',
      name: 'TOTVS RM (Oracle DBPRD)',
      type: 'ORACLE',
      envPrefix: 'ORACLE_DBPRD',
    },
  })

  // --- Dataset Fase 1: vendas com transporte ---
  // Incremental por RECMODIFIEDON (não por DATASAIDA) desde 2026-07-25: TMOV
  // e TITMMOV têm RECCREATEDON/RECMODIFIEDON — usar a data de saída como
  // marca d'água nunca capturava edições feitas depois em registros antigos
  // (mesma DATASAIDA, dado alterado no ERP). GREATEST das duas tabelas
  // garante que mudar o item (TITMMOV) também dispara a releitura da linha.
  const dataset = await prisma.dataset.upsert({
    where: { code: 'fase1_vendas_transporte' },
    update: { query: QUERY_FASE1_VENDAS, incrementalField: 'RECMODIFIEDON', incrementalType: 'DATETIME' },
    create: {
      dataSourceId: oracle.id,
      code: 'fase1_vendas_transporte',
      name: 'Fase 1 — Vendas com transporte (TOTVS RM)',
      description:
        'Movimentos de venda de carvão, cavaco e madeira com placa/motorista, base do painel de Transporte Rodoviário. Migrado do Power BI.',
      query: QUERY_FASE1_VENDAS,
      primaryKeyFields: 'CODCOLIGADA,CODFILIAL,IDMOV,CODIGOPRD',
      incrementalField: 'RECMODIFIEDON',
      incrementalType: 'DATETIME',
    },
  })

  await prisma.syncSchedule.upsert({
    where: { datasetId: dataset.id },
    update: {},
    create: { datasetId: dataset.id, intervalMinutes: 60 },
  })

  // --- Dataset: transportadoras (dTransportadorasRM) ---
  // RM.TTRA tem RECMODIFIEDON igual à consulta de vendas/transporte
  // (confirmado em all_tab_columns) — passou de carga completa para
  // incremental, mesmo padrão já usado em fase1_vendas_transporte
  // (pedido do usuário 2026-07-29).
  const transportadoras = await prisma.dataset.upsert({
    where: { code: 'dtransportadoras_rm' },
    update: { query: QUERY_TRANSPORTADORAS, incrementalField: 'RECMODIFIEDON', incrementalType: 'DATETIME' },
    create: {
      dataSourceId: oracle.id,
      code: 'dtransportadoras_rm',
      name: 'Transportadoras (TOTVS RM)',
      description: 'Cadastro de transportadoras (dTransportadorasRM do Power BI). Incremental por RECMODIFIEDON.',
      query: QUERY_TRANSPORTADORAS,
      primaryKeyFields: 'CODCOLIGADA,CODTRA',
      incrementalField: 'RECMODIFIEDON',
      incrementalType: 'DATETIME',
    },
  })
  await prisma.syncSchedule.upsert({
    where: { datasetId: transportadoras.id },
    update: {},
    create: { datasetId: transportadoras.id, intervalMinutes: 1440 },
  })

  // --- Dataset RH: cadastro de funcionários (RM.ZFUNCIONARIOS) ---
  // Pedido do usuário 2026-08-13: painel de Gestão de RH com quantidade por
  // situação (Ativo/Férias/Demitido), homens x mulheres, idade média por
  // sexo e tempo de empresa. Chave (CODCOLIGADA,CHAPA) confirmada única nas
  // 50.464 linhas (introspecção real na tabela, sem coluna de ID própria).
  // IDADE_ANOS e TEMPO_EMPRESA_ANOS calculados aqui no Oracle porque
  // DTNASCIMENTO vem como VARCHAR2 'DD/MM/YYYY' (não DATE) — mais barato
  // converter uma vez na consulta do que em toda leitura do painel.
  // PCD adicionado 2026-08-13 (mesmo dia, pedido seguinte): base para a
  // cota legal de PCD por empresa (Lei 8.213/91, art. 93) — ver
  // src/lib/rh/funcionarios.ts.
  // MEMBROCIPA adicionado no mesmo dia (aba SST — quadro descritivo de CIPA
  // e funções de segurança/saúde por empresa; sem CNAE/grau de risco nesta
  // base, não dá pra calcular o quadro MÍNIMO legal de SESMT/CIPA, só o
  // quadro ATUAL).
  // DATAESTABILIDADE adicionado no mesmo dia (pedido seguinte: avaliar se
  // cada membro da CIPA está dentro do período de estabilidade) — campo já
  // calculado pela origem (TOTVS RM), aqui só comparado com a data de hoje.
  const QUERY_RH_FUNCIONARIOS = `
SELECT
  CODCOLIGADA,
  COLIGADA,
  CODFILIAL,
  FILIAL,
  CHAPA,
  NOME,
  SITUACAO,
  CODTIPODEMISSAO,
  TIPODEMISSAO,
  DATAADMISSAO,
  DATADEMISSAO,
  CODFUNCAO,
  FUNCAO,
  CODSECAO,
  SECAO,
  CODCCUSTO,
  CCUSTO,
  CCUSTOATIVO,
  SEXO,
  DTNASCIMENTO,
  PCD,
  MEMBROCIPA,
  DATAESTABILIDADE,
  TIPOFUNCIONARIO,
  GERENCIAL,
  CBO,
  RECMODIFIEDON,
  TRUNC(MONTHS_BETWEEN(SYSDATE, TO_DATE(DTNASCIMENTO, 'DD/MM/YYYY')) / 12) AS IDADE_ANOS,
  ROUND(MONTHS_BETWEEN(NVL(DATADEMISSAO, SYSDATE), DATAADMISSAO) / 12, 1) AS TEMPO_EMPRESA_ANOS
FROM rm.zfuncionarios
`
  const datasetRh = await prisma.dataset.upsert({
    where: { code: 'rh_funcionarios' },
    update: { query: QUERY_RH_FUNCIONARIOS, incrementalField: 'RECMODIFIEDON', incrementalType: 'DATETIME' },
    create: {
      dataSourceId: oracle.id,
      code: 'rh_funcionarios',
      name: 'RH — Funcionários (TOTVS RM)',
      description:
        'Cadastro completo de funcionários (situação, admissão/demissão, sexo, idade, tempo de empresa) — base do painel de Gestão de RH.',
      query: QUERY_RH_FUNCIONARIOS,
      primaryKeyFields: 'CODCOLIGADA,CHAPA',
      incrementalField: 'RECMODIFIEDON',
      incrementalType: 'DATETIME',
    },
  })
  await prisma.syncSchedule.upsert({
    where: { datasetId: datasetRh.id },
    update: {},
    create: { datasetId: datasetRh.id, intervalMinutes: 360 },
  })
  // CODTIPODEMISSAO '5' = "TRANSFERÊNCIA SEM ÔNUS P/ CEDENTE" (confirmado na
  // origem) — pedido do usuário 2026-08-13: não é uma demissão de verdade,
  // vira categoria própria "Transferido" (fora das métricas de turnover e do
  // tempo médio de empresa dos demitidos). Demais SITUACAO fora de
  // Ativo/Férias/Demitido (afastamento INSS, licença, aviso prévio etc.,
  // ~290 registros) caem em "Outros/Afastado" — decisão do usuário, agrupar
  // em vez de esconder do painel.
  await prisma.computedColumn.upsert({
    where: { datasetId_name: { datasetId: datasetRh.id, name: 'CATEGORIA_RH' } },
    update: {
      rules: {
        rules: [
          {
            when: [
              { field: 'SITUACAO', op: 'equals', value: 'DEMITIDO' },
              { field: 'CODTIPODEMISSAO', op: 'equals', value: '5' },
            ],
            then: 'Transferido',
          },
          { when: [{ field: 'SITUACAO', op: 'equals', value: 'ATIVO' }], then: 'Ativo' },
          { when: [{ field: 'SITUACAO', op: 'equals', value: 'FÉRIAS' }], then: 'Férias' },
          { when: [{ field: 'SITUACAO', op: 'equals', value: 'DEMITIDO' }], then: 'Demitido' },
        ],
        else: 'Outros/Afastado',
      },
      position: 1,
      type: 'CONDITIONAL',
    },
    create: {
      datasetId: datasetRh.id,
      name: 'CATEGORIA_RH',
      position: 1,
      type: 'CONDITIONAL',
      rules: {
        rules: [
          {
            when: [
              { field: 'SITUACAO', op: 'equals', value: 'DEMITIDO' },
              { field: 'CODTIPODEMISSAO', op: 'equals', value: '5' },
            ],
            then: 'Transferido',
          },
          { when: [{ field: 'SITUACAO', op: 'equals', value: 'ATIVO' }], then: 'Ativo' },
          { when: [{ field: 'SITUACAO', op: 'equals', value: 'FÉRIAS' }], then: 'Férias' },
          { when: [{ field: 'SITUACAO', op: 'equals', value: 'DEMITIDO' }], then: 'Demitido' },
        ],
        else: 'Outros/Afastado',
      },
    },
  })

  // --- Fonte de dados MySQL Officium (controle de combustível) ---
  const officium = await prisma.dataSource.upsert({
    where: { id: '22a36b1c-99bd-49e8-be38-49459844edf4' },
    update: {},
    create: {
      id: '22a36b1c-99bd-49e8-be38-49459844edf4',
      name: 'Officium (MySQL)',
      type: 'MYSQL',
      envPrefix: 'MYSQL_OFFICIUM',
      config: { host: 'ldb01.grupoplantar.com.br', port: 3306, database: 'officium' },
    },
  })

  // --- Dataset: abastecimento (controle de consumo km/l) ---
  // Incremental por supply_updated_at (pedido do usuário 2026-07-29: "usar o
  // updated_at para não trazer todos os dados sempre").
  const abastecimento = await prisma.dataset.upsert({
    where: { code: 'fase1_abastecimento' },
    update: { query: QUERY_ABASTECIMENTO, incrementalField: 'supply_updated_at', incrementalType: 'DATETIME' },
    create: {
      dataSourceId: officium.id,
      code: 'fase1_abastecimento',
      name: 'Abastecimento (Officium)',
      description:
        'Notas de abastecimento por veículo (litros, placa via objects.code/oldcode), base do controle km/l do painel de Transporte Rodoviário.',
      query: QUERY_ABASTECIMENTO,
      primaryKeyFields: 'supply_id',
      incrementalField: 'supply_updated_at',
      incrementalType: 'DATETIME',
    },
  })
  await prisma.syncSchedule.upsert({
    where: { datasetId: abastecimento.id },
    update: {},
    create: { datasetId: abastecimento.id, intervalMinutes: 60 },
  })

  // --- Fonte de dados: API Controladoria (custos de transporte rodoviário) ---
  // Pedido do usuário 2026-07-30. Login por formulário (username/password),
  // não Basic Auth — authType 'session-login' no webserviceConnector faz o
  // POST /login e usa o cookie de sessão devolvido nas requisições seguintes.
  // Resposta real confirmada: { meta, totais: { geral, porMes: [{mes,
  // chave, valor}], porConta: [...] } }. Por pedido do usuário, só o bloco
  // totais.porMes interessa por enquanto — rowsPath extrai só essa lista
  // (porConta/detalhe ficam de fora do cache).
  const controladoriaConfig = {
    baseUrl: 'https://controladoria-grupo-plantar.enio-maciel.workers.dev',
    authType: 'session-login',
    loginPath: '/login',
    rowsPath: 'totais.porMes',
  }
  const controladoria = await prisma.dataSource.upsert({
    where: { id: '7c1e9a2d-4f6b-4e8a-9c3d-2b5f8a1e6d40' },
    // update também (não só create): config não é editável por tela, então
    // reaplicar o seed deve sempre convergir para o que está no código.
    update: { config: controladoriaConfig },
    create: {
      id: '7c1e9a2d-4f6b-4e8a-9c3d-2b5f8a1e6d40',
      name: 'Controladoria (custos transporte)',
      type: 'WEBSERVICE',
      envPrefix: 'CONTROLADORIA',
      config: controladoriaConfig,
    },
  })
  const custosTransporte = await prisma.dataset.upsert({
    where: { code: 'fase1_custos_transporte' },
    update: {},
    create: {
      dataSourceId: controladoria.id,
      code: 'fase1_custos_transporte',
      name: 'Custos de transporte rodoviário (Controladoria)',
      description:
        'Caderno gerencial — bloco totais.porMes (custo por mês) da API da Controladoria. Cada sincronização também gera/atualiza os parâmetros CUSTO_MES_2026<mês> (ver src/lib/sync/post-process.ts) — valor absoluto, meses com valor 0 não entram.',
      query: '/api/caderno-gerencial/custos-transporte-rodoviario',
      primaryKeyFields: 'chave',
    },
  })
  // Atualizar a cada hora (pedido do usuário 2026-07-30).
  await prisma.syncSchedule.upsert({
    where: { datasetId: custosTransporte.id },
    update: {},
    create: { datasetId: custosTransporte.id, intervalMinutes: 60 },
  })

  // --- Fonte de dados: API Omnilink Turbo (Show Tecnologia) — rastreamento ---
  // Pedido do usuário 2026-07-30, especificação fornecida por ele: login
  // (POST /api/login, token válido 24h) + consulta paginada de posições
  // (POST /api/omniturbo/relatorios/posicoes, parâmetro "parte"). Foge do
  // modelo "GET + rowsPath" do webserviceConnector genérico (é POST com
  // corpo próprio e paginação por página, não por watermark direto na URL) —
  // por isso authType vira connectorMode: 'omnilink-turbo', delegando pra
  // src/lib/sync/connectors/omnilink.ts (mesmo padrão de extensão usado
  // pelo authType 'session-login' da Controladoria).
  //
  // RESOLVIDO (2026-07-30): a conta estava sem vínculo com a frota do lado
  // da Show Tecnologia — corrigido por eles. Testado ao vivo com as 10
  // placas confirmadas pelo usuário: resposta real em `dados.tabela[]`
  // (ver comentário completo em src/lib/sync/connectors/omnilink.ts). Cada
  // linha ganha `_capturedAtIso` (calculado pelo conector a partir de
  // `envio_recepcao`) — usado como chave/marca d'água porque o campo
  // original é um intervalo em texto (DD/MM/AAAA), não ordena como string.
  const omnilink = await prisma.dataSource.upsert({
    where: { id: 'a1f0c6d2-7e4b-4a9d-9c1e-3b6f2d8a5c70' },
    update: { config: { baseUrl: 'https://api.showtecnologia.com', connectorMode: 'omnilink-turbo' } },
    create: {
      id: 'a1f0c6d2-7e4b-4a9d-9c1e-3b6f2d8a5c70',
      name: 'Omnilink Turbo (Show Tecnologia)',
      type: 'WEBSERVICE',
      envPrefix: 'OMNILINK_API',
      config: { baseUrl: 'https://api.showtecnologia.com', connectorMode: 'omnilink-turbo' },
    },
  })
  const omnilinkPosicoes = await prisma.dataset.upsert({
    where: { code: 'fase1_omnilink_posicoes' },
    update: {
      primaryKeyFields: 'placa,_capturedAtIso',
      incrementalField: '_capturedAtIso',
      incrementalType: 'DATETIME',
    },
    create: {
      dataSourceId: omnilink.id,
      code: 'fase1_omnilink_posicoes',
      name: 'Posições e eventos (Omnilink Turbo)',
      description:
        'Posições/eventos dos rastreadores da frota própria (Show Tecnologia/Omnilink). Alimenta VehiclePosition para o mapa da frota via post-process (src/lib/sync/post-process.ts).',
      query: 'POST /api/omniturbo/relatorios/posicoes (login + paginação por "parte", ver connectorMode)',
      primaryKeyFields: 'placa,_capturedAtIso',
      incrementalField: '_capturedAtIso',
      incrementalType: 'DATETIME',
    },
  })
  await prisma.syncSchedule.upsert({
    where: { datasetId: omnilinkPosicoes.id },
    update: { enabled: true },
    create: { datasetId: omnilinkPosicoes.id, intervalMinutes: 15, enabled: true },
  })

  // --- Colunas condicionais (migradas das etapas do PowerQuery) ---
  const computedColumns: {
    name: string
    position: number
    type?: 'CONDITIONAL' | 'LOOKUP'
    rules: object
  }[] = [
    // Classificação de produto via cadastro ProductType (por CODIGOPRD) —
    // antes era uma regra condicional fixa por trecho do nome (PRODUTO), que
    // tinha um bug de acentuação (não pegava "LENHA PARA CARVÃO" por causa do
    // "Ã") e não deixava o usuário associar produtos novos. Editável em
    // Cadastros → Produtos.
    {
      name: 'TipoProduto',
      position: 1,
      type: 'LOOKUP',
      rules: {
        table: 'ProductType',
        localFields: { codigoPrd: 'CODIGOPRD' },
        return: 'tipoProduto',
      },
    },
    // Origem (UPC) via cadastro de Locais — antes era uma regra condicional
    // fixa que ficou desatualizada (não conhecia unidades cadastradas
    // depois dela: UTM, Planep-MG03/04, Zanini-MG04) e jogava a maioria das
    // linhas em "Outros". LOOKUP usa o mesmo cadastro do casamento de rotas,
    // nunca fica dessincronizado.
    {
      name: 'UPC',
      position: 2,
      type: 'LOOKUP',
      rules: {
        table: 'Location',
        localFields: { coligada: 'CODCOLIGADA', filial: 'CODFILIAL' },
        return: 'name',
      },
    },
    {
      name: 'TipoComposição',
      position: 3,
      rules: {
        rules: [
          { when: [{ field: 'PLACA', op: 'in', value: ['SES5B24', 'SES5B32', 'TAM6F66'] }], then: 'Rodo Caçamba' },
          { when: [{ field: 'PLACA', op: 'in', value: PLACAS_RODOTREM }], then: 'RodoTrem' },
          { when: [{ field: 'PLACA', op: 'in', value: PLACAS_LS4 }], then: 'LS 4 Eixos' },
          { when: [{ field: 'PLACA', op: 'in', value: ['RHX5D99', 'RHX5E04', 'SDU4H73', 'SDU4H74', 'SDU4H75'] }], then: 'LS 3 Eixos' },
          { when: [{ field: 'PLACA', op: 'in', value: ['HBG1A08', 'OWN7G03', 'RHG9E93'] }], then: 'BiTrem' },
          { when: [{ field: 'PLACA', op: 'in', value: ['RH0OE27'] }], then: 'Romeu e Julieta' },
        ],
        else: 'Outros',
      },
    },
    // Nome da transportadora via lookup no dataset dtransportadoras_rm
    // (equivale à etapa "Consultas Mescladas" + expansão do PowerQuery)
    {
      name: 'TransportadoraNome',
      position: 4,
      type: 'LOOKUP',
      rules: {
        dataset: 'dtransportadoras_rm',
        matchOn: [
          { local: 'CODTRA', remote: 'CODTRA' },
          { local: 'CODCOLIGADA', remote: 'CODCOLIGADA' },
        ],
        return: 'NOME',
      },
    },
    // Classificação frete próprio × terceiro (etapa "Coluna Condicional
    // Adicionada2" + "Erros Substituídos" do PowerQuery: sem transportadora -> Outros)
    {
      name: 'Consolida Transportadora',
      position: 5,
      rules: {
        rules: [
          { when: [{ field: 'TransportadoraNome', op: 'equals', value: '' }], then: 'Outros' },
          { when: [{ field: 'TransportadoraNome', op: 'contains', value: 'PLANTAR' }], then: 'Proprio' },
          { when: [{ field: 'TransportadoraNome', op: 'contains', value: 'ZANINI' }], then: 'Proprio' },
          { when: [{ field: 'TransportadoraNome', op: 'contains', value: 'UPC' }], then: 'Proprio' },
        ],
        else: 'Terceiro',
      },
    },
    // Distância da rota via cadastro Route (etapa "Coluna Distancia" do
    // PowerQuery, agora editável pelo usuário no cadastro de rotas)
    {
      name: 'Distancia',
      position: 6,
      type: 'LOOKUP',
      rules: {
        table: 'Route',
        localFields: { coligada: 'CODCOLIGADA', filial: 'CODFILIAL', cliente: 'NOMEFANTASIA' },
        return: 'distanceKm',
      },
    },
  ]

  for (const col of computedColumns) {
    await prisma.computedColumn.upsert({
      where: { datasetId_name: { datasetId: dataset.id, name: col.name } },
      update: { rules: col.rules, position: col.position, type: col.type ?? 'CONDITIONAL' },
      create: {
        datasetId: dataset.id,
        name: col.name,
        position: col.position,
        type: col.type ?? 'CONDITIONAL',
        rules: col.rules,
      },
    })
  }

  // --- Dataset Fase 3: vendas de madeira tratada (perda de preço) ---
  // Incremental por RECMODIFIEDON, mesmo padrão de fase1_vendas_transporte.
  const datasetFase3 = await prisma.dataset.upsert({
    where: { code: 'fase3_vendas_madeira_tratada' },
    update: {
      query: QUERY_FASE3_VENDAS_MADEIRA,
      primaryKeyFields: 'CODCOLIGADA,CODFILIAL,IDMOV,CODIGOPRD,NSEQITMMOV',
      incrementalField: 'RECMODIFIEDON',
      incrementalType: 'DATETIME',
    },
    create: {
      dataSourceId: oracle.id,
      code: 'fase3_vendas_madeira_tratada',
      name: 'Fase 3 — Vendas de madeira tratada (TOTVS RM)',
      description:
        'Movimentos de venda de madeira tratada/agronegócio/perfil com preço, desconto, m³ e distribuidor — base do painel de perda de preço. Migrado do Power BI "Planep_Faturamento_New".',
      query: QUERY_FASE3_VENDAS_MADEIRA,
      // BUG REAL corrigido 2026-08-04: (CODCOLIGADA,CODFILIAL,IDMOV,CODIGOPRD)
      // NÃO é único — o mesmo produto pode aparecer 2x na MESMA NF com
      // preço/quantidade diferentes (ex.: correção de preço parcelada na
      // mesma linha de produto), cada ocorrência com seu próprio
      // TITMMOV.NSEQITMMOV. Sem esse campo na chave, o upsert do sync
      // descartava silenciosamente uma das duas linhas — em julho/2026,
      // 24 de 1.143 linhas (2,1%) eram perdidas assim, exatamente a escala
      // da divergência de m³/faturamento contra o Power BI que o usuário
      // reportou (achado confirmado comparando produto a produto contra um
      // export real do BI).
      primaryKeyFields: 'CODCOLIGADA,CODFILIAL,IDMOV,CODIGOPRD,NSEQITMMOV',
      incrementalField: 'RECMODIFIEDON',
      incrementalType: 'DATETIME',
    },
  })
  await prisma.syncSchedule.upsert({
    where: { datasetId: datasetFase3.id },
    update: {},
    create: { datasetId: datasetFase3.id, intervalMinutes: 60 },
  })

  // Classificação TipoProduto — migrada literalmente da cascata Text.Contains
  // do PowerQuery de D_PRODUTOS (etapa "Add TipoProduto"), na MESMA ordem
  // (primeira regra que bate vence) — "Agronegócio" é o balde padrão (else),
  // não uma regra explícita, para qualquer produto de madeira tratada que não
  // caia em nenhuma categoria específica abaixo.
  const computedColumnsFase3: {
    name: string
    position: number
    type?: 'CONDITIONAL' | 'LOOKUP'
    rules: object
  }[] = [
    {
      name: 'TipoProduto',
      position: 1,
      rules: {
        rules: [
          { when: [{ field: 'PRODUTO', op: 'contains', value: 'CEMIG' }], then: 'CEMIG' },
          { when: [{ field: 'PRODUTO', op: 'contains', value: 'LENHA DE EUCALIPTO - UTM' }], then: 'Lenha UTM' },
          { when: [{ field: 'PRODUTO', op: 'contains', value: 'RESIDUO DE MADEIRA - SEM TRATAMENTO' }], then: 'Lenha UTM' },
          { when: [{ field: 'PRODUTO', op: 'contains', value: 'POSTE IN NATURA' }], then: 'Lenha UTM' },
          { when: [{ field: 'PRODUTO', op: 'contains', value: 'RESIDUO DE MADEIRA TRATADA' }], then: 'Resíduo Tratado' },
          { when: [{ field: 'PRODUTO', op: 'contains', value: 'LENHA - CLASSE 2' }], then: 'Resíduo Colheita' },
          { when: [{ field: 'PRODUTO', op: 'contains', value: 'LENHA DE EUCALIPTO - FIBRIA' }], then: 'Lenha' },
          { when: [{ field: 'PRODUTO', op: 'contains', value: 'SERRAGEM' }], then: 'Serragem' },
          { when: [{ field: 'PRODUTO', op: 'contains', value: 'CONSTRUÇÃO CIVIL' }], then: 'Construção Civil' },
          { when: [{ field: 'PRODUTO', op: 'contains', value: 'MADEIRA TRATADA LINHA 2' }], then: 'Resíduo Tratado' },
          { when: [{ field: 'PRODUTO', op: 'contains', value: 'PERFILADO PREMIUM TRATADO' }], then: 'Perfil' },
          { when: [{ field: 'PRODUTO', op: 'contains', value: 'PERFILADO ARCO TRATADO' }], then: 'Perfil' },
          { when: [{ field: 'PRODUTO', op: 'contains', value: 'PERFILADO TRATADO' }], then: 'Perfil' },
          { when: [{ field: 'PRODUTO', op: 'contains', value: 'PERFILADO PREMIUM SEM TRATAMENTO' }], then: 'Perfil In-Natura' },
          { when: [{ field: 'PRODUTO', op: 'contains', value: 'PERFILADO ARCO SEM TRATAMENTO' }], then: 'Perfil In-Natura' },
          { when: [{ field: 'PRODUTO', op: 'contains', value: '(PALANQUE) DE AMARU TRATADO - LINHA 2' }], then: 'Resíduo Tratado' },
          { when: [{ field: 'PRODUTO', op: 'contains', value: 'PERFILADA TRATADA LINHA 2' }], then: 'Perfil - Linha 2' },
          { when: [{ field: 'PRODUTO', op: 'contains', value: 'LENHA PARA CARVÃO' }], then: 'Lenha' },
          { when: [{ field: 'PRODUTO', op: 'contains', value: 'MARAVALHA' }], then: 'Maravalha' },
        ],
        else: 'Agronegócio',
      },
    },
    // Movimento: devolução/bonificação/venda — decide o sinal e se entra nas
    // métricas de venda (Total m3 vendido etc. excluem Bonificacoes).
    {
      name: 'TipoMovimento',
      position: 3,
      rules: {
        rules: [
          { when: [{ field: 'CODTMV', op: 'in', value: ['1.2.83', '1.2.84'] }], then: 'Devolucoes' },
          { when: [{ field: 'CODTMV', op: 'equals', value: '2.2.48' }], then: 'Bonificacoes' },
        ],
        else: 'Vendas',
      },
    },
    // Abreviação do distribuidor (etapa "Coluna Condicional Adicionada" de
    // D_CLIENTES) — texto bruto de DISTRIBUIDOR já vem com prefixo de código
    // (ex.: "C00003288 - TOP TOP..."), mas "contains" não normaliza acento e
    // não se importa com o prefixo, então a regra bate igual sem precisar
    // remover o código antes.
    //
    // BUG REAL corrigido em 2026-08-04: o PowerQuery original checa
    // Text.Contains([DISTRIBUIDOR], "TOPTOP") DEPOIS de remover todos os
    // espaços do campo (`Table.ReplaceValue(..., " ", "", ...)`), então
    // "TOP TOP MADEIRAS..." vira "TOPTOPMADEIRAS..." antes da comparação.
    // Nossa regra comparava direto contra o texto bruto (com espaço), então
    // "TOPTOP" NUNCA batia com "TOP TOP MADEIRAS TRATADAS - EIRELI - ME" —
    // as ~5.045 vendas da TOP TOP (2022 até hoje) caíam silenciosamente em
    // "SEM DISTRIBUIDOR". Corrigido usando "TOP TOP" (com espaço, igual ao
    // texto real no Oracle) em vez de replicar o passo de remover espaços.
    {
      name: 'ABREV_DISTRIBUIDOR',
      position: 4,
      rules: {
        rules: [
          { when: [{ field: 'DISTRIBUIDOR', op: 'contains', value: 'PLANEP' }], then: 'PLANEP' },
          { when: [{ field: 'DISTRIBUIDOR', op: 'contains', value: 'TOP TOP' }], then: 'TOP TOP' },
          { when: [{ field: 'DISTRIBUIDOR', op: 'contains', value: 'EXTRA' }], then: 'EXTRA' },
          { when: [{ field: 'DISTRIBUIDOR', op: 'contains', value: 'GREANY' }], then: 'GREANY´S' },
          { when: [{ field: 'DISTRIBUIDOR', op: 'contains', value: 'RURAL' }], then: 'RURAL MADEIRAS' },
        ],
        else: 'SEM DISTRIBUIDOR',
      },
    },
    // Preço mínimo ponderado (m3_minimo) por ICMS x TipoProduto — migrado
    // literalmente da coluna m3_minimo do PowerQuery (valores conferidos
    // 2026-08-03 contra o modelo Power BI ao vivo). As variantes
    // "DISTRIBUIDOR X% 2020" do PowerQuery original nunca ocorrem nesta
    // consulta (TABELA_PRECO aqui só assume os 3 valores ICMS, calculados em
    // SQL) — por isso omitidas, sem perda de cobertura.
    {
      name: 'm3_minimo',
      position: 5,
      rules: {
        rules: [
          { when: [{ field: 'TABELA_PRECO', op: 'equals', value: 'ICMS 7%' }, { field: 'TipoProduto', op: 'equals', value: 'Agronegócio' }], then: 1131.76 },
          { when: [{ field: 'TABELA_PRECO', op: 'equals', value: 'ICMS 12%' }, { field: 'TipoProduto', op: 'equals', value: 'Agronegócio' }], then: 1238.47 },
          { when: [{ field: 'TABELA_PRECO', op: 'equals', value: 'ICMS 18%' }, { field: 'TipoProduto', op: 'equals', value: 'Agronegócio' }], then: 1395.83 },
          { when: [{ field: 'TABELA_PRECO', op: 'equals', value: 'ICMS 7%' }, { field: 'TipoProduto', op: 'equals', value: 'Perfil' }], then: 2675 },
          { when: [{ field: 'TABELA_PRECO', op: 'equals', value: 'ICMS 12%' }, { field: 'TipoProduto', op: 'equals', value: 'Perfil' }], then: 2675 },
          { when: [{ field: 'TABELA_PRECO', op: 'equals', value: 'ICMS 18%' }, { field: 'TipoProduto', op: 'equals', value: 'Perfil' }], then: 2675 },
        ],
        else: 0,
      },
    },
    // SubTipoProduto (pedido original da nota Fase 3, nunca implementado até
    // 2026-08-04): dentro de "Agronegócio", produto com "2,20" no nome vira
    // "Mourão"; qualquer outro Agronegócio vira "Peças" — é essa divisão que
    // faltava para a análise de "melhor carga" (Mourão x Peças por ICMS).
    // Fora de Agronegócio, SubTipoProduto só repete o TipoProduto.
    {
      name: 'SubTipoProduto',
      position: 6,
      rules: {
        rules: [
          { when: [{ field: 'TipoProduto', op: 'equals', value: 'Agronegócio' }, { field: 'PRODUTO', op: 'contains', value: '2,20' }], then: 'Mourão' },
          { when: [{ field: 'TipoProduto', op: 'equals', value: 'Agronegócio' }], then: 'Peças' },
          { when: [{ field: 'TipoProduto', op: 'equals', value: 'CEMIG' }], then: 'CEMIG' },
          { when: [{ field: 'TipoProduto', op: 'equals', value: 'Perfil In-Natura' }], then: 'Perfil In-Natura' },
          { when: [{ field: 'TipoProduto', op: 'equals', value: 'Perfil' }], then: 'Perfil' },
          { when: [{ field: 'TipoProduto', op: 'equals', value: 'Serragem' }], then: 'Serragem' },
          { when: [{ field: 'TipoProduto', op: 'equals', value: 'Lenha UTM' }], then: 'Lenha UTM' },
          { when: [{ field: 'TipoProduto', op: 'equals', value: 'Lenha' }], then: 'Lenha' },
          { when: [{ field: 'TipoProduto', op: 'equals', value: 'Resíduo Colheita' }], then: 'Resíduo Colheita' },
          { when: [{ field: 'TipoProduto', op: 'equals', value: 'Resíduo Tratado' }], then: 'Resíduo Tratado' },
          { when: [{ field: 'TipoProduto', op: 'equals', value: 'Construção Civil' }], then: 'Construção Civil' },
          { when: [{ field: 'TipoProduto', op: 'equals', value: 'Maravalha' }], then: 'Maravalha' },
          { when: [{ field: 'TipoProduto', op: 'equals', value: 'Perfil - Linha 2' }], then: 'Perfil 2' },
        ],
        else: 'Outros',
      },
    },
    // Marca (pedido original, nunca implementado): separa "Amaru Standard"
    // (inclusive a grafia "STANDART" sem D, encontrada nos dados reais) do
    // "Amaru" padrão.
    {
      name: 'Marca',
      position: 7,
      rules: {
        rules: [
          { when: [{ field: 'PRODUTO', op: 'contains', value: 'AMARU STANDARD' }], then: 'Amaru Standard' },
          { when: [{ field: 'PRODUTO', op: 'contains', value: 'AMARU STANDART' }], then: 'Amaru Standard' },
        ],
        else: 'Amaru',
      },
    },
    // Tamanho (comprimento em metros, lido do início do nome do produto) —
    // pedido original, nunca implementado.
    {
      name: 'Tamanho',
      position: 8,
      rules: {
        rules: [
          { when: [{ field: 'PRODUTO', op: 'startsWith', value: '2,20' }], then: 2.2 },
          { when: [{ field: 'PRODUTO', op: 'startsWith', value: '1,60' }], then: 1.6 },
          { when: [{ field: 'PRODUTO', op: 'startsWith', value: '2,50' }], then: 2.5 },
          { when: [{ field: 'PRODUTO', op: 'startsWith', value: '2,80' }], then: 2.8 },
          { when: [{ field: 'PRODUTO', op: 'startsWith', value: '3,20' }], then: 3.2 },
        ],
        else: 'Outros',
      },
    },
    // Produto_Classe_Diametro (faixa de diâmetro lida do nome) — pedido
    // original, nunca implementado. Ordem das regras preservada da nota
    // original (X 08 tem faixa própria, diferente de X 04/X 06).
    {
      name: 'Produto_Classe_Diametro',
      position: 9,
      rules: {
        rules: [
          { when: [{ field: 'PRODUTO', op: 'contains', value: 'X 04 -' }], then: '04 a 08' },
          { when: [{ field: 'PRODUTO', op: 'contains', value: 'X 06 -' }], then: '04 a 08' },
          { when: [{ field: 'PRODUTO', op: 'contains', value: 'X 08 -' }], then: '08 a 12' },
          { when: [{ field: 'PRODUTO', op: 'contains', value: 'X 18 -' }], then: '18 a 20' },
          { when: [{ field: 'PRODUTO', op: 'contains', value: 'X 14 -' }], then: '12 a 16' },
          { when: [{ field: 'PRODUTO', op: 'contains', value: 'X 16 -' }], then: '12 a 16' },
          { when: [{ field: 'PRODUTO', op: 'contains', value: 'X 12 -' }], then: '12 a 16' },
        ],
        else: 'Outros',
      },
    },
  ]

  for (const col of computedColumnsFase3) {
    await prisma.computedColumn.upsert({
      where: { datasetId_name: { datasetId: datasetFase3.id, name: col.name } },
      update: { rules: col.rules, position: col.position, type: col.type ?? 'CONDITIONAL' },
      create: {
        datasetId: datasetFase3.id,
        name: col.name,
        position: col.position,
        type: col.type ?? 'CONDITIONAL',
        rules: col.rules,
      },
    })
  }

  // --- Dataset Fase 3: cadastro de clientes (D_CLIENTES) ---
  // Incremental por RECMODIFIEDON. Serve de base para a aba de clientes
  // inativos/prospecção (e-mail/telefone/distribuidor por cliente).
  const datasetFase3Clientes = await prisma.dataset.upsert({
    where: { code: 'fase3_clientes' },
    update: { query: QUERY_FASE3_CLIENTES, incrementalField: 'RECMODIFIEDON', incrementalType: 'DATETIME' },
    create: {
      dataSourceId: oracle.id,
      code: 'fase3_clientes',
      name: 'Fase 3 — Cadastro de clientes (TOTVS RM)',
      description: 'Cadastro de clientes com distribuidor e contato (e-mail/telefone) — migrado de D_CLIENTES do Power BI "Planep_Faturamento_New".',
      query: QUERY_FASE3_CLIENTES,
      primaryKeyFields: 'CODCFO',
      incrementalField: 'RECMODIFIEDON',
      incrementalType: 'DATETIME',
    },
  })
  await prisma.syncSchedule.upsert({
    where: { datasetId: datasetFase3Clientes.id },
    update: {},
    create: { datasetId: datasetFase3Clientes.id, intervalMinutes: 60 },
  })
  await prisma.computedColumn.upsert({
    where: { datasetId_name: { datasetId: datasetFase3Clientes.id, name: 'ABREV_DISTRIBUIDOR' } },
    update: { rules: computedColumnsFase3.find((c) => c.name === 'ABREV_DISTRIBUIDOR')!.rules, position: 1, type: 'CONDITIONAL' },
    create: {
      datasetId: datasetFase3Clientes.id,
      name: 'ABREV_DISTRIBUIDOR',
      position: 1,
      type: 'CONDITIONAL',
      rules: computedColumnsFase3.find((c) => c.name === 'ABREV_DISTRIBUIDOR')!.rules,
    },
  })

  // --- Tabela de referência: peso máximo por composição (conformidade) ---
  // Valores fornecidos pelo usuário em 2026-07-25. update:{} preserva ajustes
  // feitos pela tela de Cadastros → Composições — reexecutar o seed nunca
  // sobrescreve o que o usuário editar.
  const compositionSpecs: {
    composition: string
    numEixos: string | null
    pbtcMaximoTon: number | null
    taraMinTon: number | null
    taraMaxTon: number | null
    cargaLiquidaMinTon: number | null
    cargaLiquidaMaxTon: number | null
  }[] = [
    { composition: 'LS 3 Eixos', numEixos: '3 eixos no semirreboque (6 eixos total)', pbtcMaximoTon: 48.5, taraMinTon: 16, taraMaxTon: 18, cargaLiquidaMinTon: 30, cargaLiquidaMaxTon: 32 },
    { composition: 'LS 4 Eixos', numEixos: '4 eixos no semirreboque (7 eixos total)', pbtcMaximoTon: 57.0, taraMinTon: 18, taraMaxTon: 20, cargaLiquidaMinTon: 37, cargaLiquidaMaxTon: 39 },
    { composition: 'RodoTrem', numEixos: '9 eixos', pbtcMaximoTon: 74.0, taraMinTon: 24, taraMaxTon: 27, cargaLiquidaMinTon: 47, cargaLiquidaMaxTon: 50 },
    { composition: 'BiTrem', numEixos: '7 eixos', pbtcMaximoTon: 57.0, taraMinTon: 17, taraMaxTon: 19, cargaLiquidaMinTon: 38, cargaLiquidaMaxTon: 40 },
    { composition: 'Tritrem Florestal', numEixos: '9 eixos', pbtcMaximoTon: 74.0, taraMinTon: 22, taraMaxTon: 25, cargaLiquidaMinTon: 49, cargaLiquidaMaxTon: 52 },
    // Sem peso definido ainda (usuário preenche pela tela quando tiver o dado)
    // — precisam existir aqui para o campo de composição parar de ser texto
    // livre e virar seleção fechada, sem perder placas já cadastradas com
    // estes valores.
    { composition: 'Rodo Caçamba', numEixos: null, pbtcMaximoTon: null, taraMinTon: null, taraMaxTon: null, cargaLiquidaMinTon: null, cargaLiquidaMaxTon: null },
    { composition: 'Romeu e Julieta', numEixos: null, pbtcMaximoTon: null, taraMinTon: null, taraMaxTon: null, cargaLiquidaMinTon: null, cargaLiquidaMaxTon: null },
    { composition: 'Outros', numEixos: null, pbtcMaximoTon: null, taraMinTon: null, taraMaxTon: null, cargaLiquidaMinTon: null, cargaLiquidaMaxTon: null },
  ]
  for (const s of compositionSpecs) {
    await prisma.compositionSpec.upsert({
      where: { composition: s.composition },
      update: {},
      create: s,
    })
  }

  // --- Cadastro de classificação de produto (ProductType) ---
  // Semeado a partir dos CODIGOPRD realmente encontrados na sincronização
  // (2026-07-25). update:{} preserva ajustes feitos pela tela de Cadastros →
  // Produtos. "LENHA PARA CARVÃO" é transporte de MADEIRA (matéria-prima),
  // produto diferente de "CARVÃO VEGETAL" (o carvão em si) — confirmado pelo
  // usuário em 2026-07-25. Fica em "Madeira", separado de "Carvão".
  const productTypes: { codigoPrd: string; produtoNome: string; tipoProduto: string }[] = [
    { codigoPrd: '42.57.000002', produtoNome: 'CARVAO VEGETAL ORIGEM FLORESTA PLANTADA', tipoProduto: 'Carvão' },
    { codigoPrd: '42.56.000025', produtoNome: 'LENHA PARA CARVÃO ORIGEM FLORESTA PLANTADA', tipoProduto: 'Madeira' },
    { codigoPrd: '42.59.000001', produtoNome: 'CAVACO - ORIGEM FLORESTA PLANTADA', tipoProduto: 'Cavaco' },
    { codigoPrd: '42.56.000027', produtoNome: 'LENHA PARA CAVACO ORIGEM FLORESTA PLANTADA', tipoProduto: 'Cavaco' },
    { codigoPrd: '95.10.000012', produtoNome: 'MARAVALHA A GRANEL PLANTAR - ORIGEM FLORESTA PLANTADA', tipoProduto: 'Maravalha' },
    { codigoPrd: '95.10.000002', produtoNome: 'SERRAGEM - ORIGEM FLORESTA PLANTADA', tipoProduto: 'Outros' },
    { codigoPrd: '42.56.000001', produtoNome: 'MADEIRA P/ MOURAO/PECAS ORIGEM FLORESTA PLANTADA', tipoProduto: 'Outros' },
    { codigoPrd: '42.56.000002', produtoNome: 'MADEIRA P/ PERFIL ORIGEM FLORESTA PLANTADA', tipoProduto: 'Outros' },
  ]
  for (const p of productTypes) {
    await prisma.productType.upsert({
      where: { codigoPrd: p.codigoPrd },
      update: {},
      create: p,
    })
  }

  // --- Cadastro de locais (unidades do grupo e clientes) ---
  // ATENÇÃO: locais e rotas pertencem ao USUÁRIO depois do bootstrap inicial.
  // O seed só cria estes cadastros quando a tabela está VAZIA — reexecutar o
  // seed nunca pode recriar/duplicar locais que o usuário renomeou ou ajustou
  // (aconteceu em 2026-07-24: usuário renomeou para nomes amigáveis e o seed
  // recriou os antigos pelo nome).
  const existingLocations = await prisma.location.count()
  if (existingLocations > 0) {
    console.log('Locais já cadastrados — seed de locais/rotas ignorado (dados pertencem ao usuário).')
  } else {
  const unidades: { name: string; matchColigada: number; matchFilial?: number }[] = [
    { name: 'Almas (colig. 5)', matchColigada: 5 },
    { name: 'Filial 5/3', matchColigada: 5, matchFilial: 3 },
    { name: 'Filial 5/4', matchColigada: 5, matchFilial: 4 },
    { name: 'Jacaré', matchColigada: 6, matchFilial: 6 },
    { name: 'Buriti Grande', matchColigada: 6, matchFilial: 4 },
    { name: 'Mato Seco', matchColigada: 6, matchFilial: 9 },
    { name: 'Matias Barbosa', matchColigada: 28, matchFilial: 5 },
    { name: 'UPC Jacaré', matchColigada: 33 },
    { name: 'UPC Buriti Grande', matchColigada: 34 },
  ]
  const clientes: { name: string; matchClientePattern: string }[] = [
    { name: 'Palmyra', matchClientePattern: 'PALMYRA' },
    { name: 'Ferbasa', matchClientePattern: 'FERBASA' },
    { name: 'Bozel', matchClientePattern: 'BOZEL' },
    { name: 'Planep', matchClientePattern: 'PLANEP' },
    { name: 'Fazenda Gineta', matchClientePattern: 'FAZENDA GINETA' },
    { name: 'Fazenda Riacho', matchClientePattern: 'FAZENDA RIACHO' },
    { name: 'Fazenda Pompeu Velho/Santa Cruz', matchClientePattern: 'FAZENDA POMPEU VELHO/ SANTA CRUZ' },
  ]

  const locationIds = new Map<string, string>()
  for (const u of unidades) {
    const loc = await prisma.location.upsert({
      where: { name: u.name },
      update: { matchColigada: u.matchColigada, matchFilial: u.matchFilial ?? null },
      create: { name: u.name, type: 'UNIDADE', matchColigada: u.matchColigada, matchFilial: u.matchFilial },
    })
    locationIds.set(u.name, loc.id)
  }
  for (const c of clientes) {
    const loc = await prisma.location.upsert({
      where: { name: c.name },
      update: { matchClientePattern: c.matchClientePattern },
      create: { name: c.name, type: 'CLIENTE', matchClientePattern: c.matchClientePattern },
    })
    locationIds.set(c.name, loc.id)
  }

  // --- Cadastro de rotas (distâncias que estavam fixas no PowerQuery) ---
  // Distância total lançada como asfalto; o usuário divide asfalto × terra e
  // preenche velocidades cheio/vazio e tempos de carga/descarga pela tela.
  // Expectativa de ida e volta (dias) definida pelo usuário em 2026-07-24:
  // Bozel e Palmyra 2,5 dias; Ferbasa 5 dias.
  const daysFor = (destination: string): number | undefined => {
    if (destination === 'Bozel' || destination === 'Palmyra') return 2.5
    if (destination === 'Ferbasa') return 5
    return undefined
  }
  const routes: { origin: string; destination: string; asphaltKm: number }[] = [
    { origin: 'Almas (colig. 5)', destination: 'Palmyra', asphaltKm: 377 },
    { origin: 'Jacaré', destination: 'Palmyra', asphaltKm: 415 },
    { origin: 'UPC Jacaré', destination: 'Palmyra', asphaltKm: 415 },
    { origin: 'Buriti Grande', destination: 'Palmyra', asphaltKm: 506 },
    { origin: 'UPC Buriti Grande', destination: 'Palmyra', asphaltKm: 506 },
    { origin: 'Almas (colig. 5)', destination: 'Ferbasa', asphaltKm: 1261 },
    { origin: 'Jacaré', destination: 'Ferbasa', asphaltKm: 1308 },
    { origin: 'UPC Jacaré', destination: 'Ferbasa', asphaltKm: 1308 },
    { origin: 'Buriti Grande', destination: 'Ferbasa', asphaltKm: 1489 },
    { origin: 'UPC Buriti Grande', destination: 'Ferbasa', asphaltKm: 1489 },
    { origin: 'Almas (colig. 5)', destination: 'Bozel', asphaltKm: 355 },
    { origin: 'Jacaré', destination: 'Bozel', asphaltKm: 394 },
    { origin: 'UPC Jacaré', destination: 'Bozel', asphaltKm: 394 },
    { origin: 'Buriti Grande', destination: 'Bozel', asphaltKm: 412 },
    { origin: 'UPC Buriti Grande', destination: 'Bozel', asphaltKm: 412 },
    { origin: 'Filial 5/4', destination: 'Planep', asphaltKm: 80 },
    { origin: 'Filial 5/3', destination: 'Fazenda Gineta', asphaltKm: 85 },
    { origin: 'Filial 5/3', destination: 'Fazenda Riacho', asphaltKm: 144 },
    { origin: 'Filial 5/3', destination: 'Fazenda Pompeu Velho/Santa Cruz', asphaltKm: 103 },
  ]

  for (const r of routes) {
    const originId = locationIds.get(r.origin)!
    const destinationId = locationIds.get(r.destination)!
    const expectedRoundTripDays = daysFor(r.destination)
    await prisma.route.upsert({
      where: { originId_destinationId: { originId, destinationId } },
      update: expectedRoundTripDays !== undefined ? { expectedRoundTripDays } : {},
      create: { originId, destinationId, distanceAsphaltKm: r.asphaltKm, expectedRoundTripDays },
    })
  }
  } // fim do bootstrap de locais/rotas (só roda com a tabela vazia)

  console.log('Seed concluído: admin, módulos, parâmetros, fonte Oracle, dataset Fase 1, colunas condicionais e rotas.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
