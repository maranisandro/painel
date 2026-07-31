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

// Cadastro de transportadoras (dTransportadorasRM no Power BI). Adaptações
// em relação ao PowerQuery: o filtro de coligadas virou WHERE e a correção
// "VIANA & MATOS LTDA" -> "VIANA E MATOS LTDA" virou REPLACE no SQL.
const QUERY_TRANSPORTADORAS = `
SELECT CODCOLIGADA, CODTRA, REPLACE(NOME, 'VIANA & MATOS LTDA', 'VIANA E MATOS LTDA') NOME, RECMODIFIEDON
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
    { code: 'fase3', name: 'Produção e Venda de Madeira Tratada', phase: 3, active: false },
    { code: 'fase4', name: 'Produção e Venda de Cavaco', phase: 4, active: false },
    { code: 'fase5', name: 'Transporte Interno de Madeira', phase: 5, active: false },
  ]
  for (const m of modules) {
    await prisma.module.upsert({ where: { code: m.code }, update: { name: m.name }, create: m })
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
