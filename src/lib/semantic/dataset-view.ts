import { prisma } from '@/lib/prisma'
import { applyComputedColumns, evaluateConditional, type ConditionalRules } from './computed-columns'

type Row = Record<string, unknown>

export interface LookupRules {
  /** code do dataset de referência (lookup dataset → dataset) */
  dataset?: string
  /** pares de campos para o casamento (local = dataset atual, remote = referência) */
  matchOn?: { local: string; remote: string }[]
  /** nome do cadastro de apoio (lookup dataset → tabela). Suportado: "Route", "ProductType", "Location" */
  table?: string
  /** campos locais usados no casamento com o cadastro (formato por tabela) */
  localFields?: Record<string, string>
  /** campo a retornar */
  return: string
}

function lookupKey(row: Row, fields: string[]): string {
  return fields.map((f) => String(row[f] ?? '').toUpperCase().trim()).join('|')
}

/**
 * Retorna as linhas de um dataset com todas as colunas condicionais e de
 * lookup aplicadas, em ordem de posição. Os valores originais (DatasetRow.data)
 * permanecem intactos no banco — o enriquecimento acontece só na leitura.
 * É esta a visão que os painéis consomem.
 */
export async function getDatasetView(datasetCode: string): Promise<Row[]> {
  const dataset = await prisma.dataset.findUniqueOrThrow({
    where: { code: datasetCode },
    include: { computedColumns: { where: { active: true }, orderBy: { position: 'asc' } } },
  })

  const rows = await prisma.datasetRow.findMany({
    where: { datasetId: dataset.id },
    select: { data: true },
  })
  let view: Row[] = rows.map((r) => ({ ...(r.data as Row) }))

  for (const col of dataset.computedColumns) {
    if (col.type === 'LOOKUP' && (col.rules as unknown as LookupRules).table === 'Route') {
      // Lookup no cadastro de rotas: a origem (Local tipo UNIDADE) casa por
      // coligada/filial e o destino (Local tipo CLIENTE) por trecho do nome
      // do cliente. Entre as rotas candidatas vence a de origem mais
      // específica — replica a ordem de condições da etapa "Coluna Distancia"
      // do PowerQuery. "distanceKm" retorna asfalto + terra.
      const rules = col.rules as unknown as LookupRules
      const fields = rules.localFields ?? { coligada: 'CODCOLIGADA', filial: 'CODFILIAL', cliente: 'NOMEFANTASIA' }
      const routes = await prisma.route.findMany({
        where: { active: true },
        include: { origin: true, destination: true },
      })
      view = view.map((row) => {
        const coligada = Number(row[fields.coligada])
        const filial = Number(row[fields.filial])
        const cliente = String(row[fields.cliente] ?? '').toUpperCase()
        let best: { specificity: number; value: unknown } | null = null
        for (const route of routes) {
          const dest = route.destination
          const orig = route.origin
          if (!dest.matchClientePattern || !cliente.includes(dest.matchClientePattern.toUpperCase())) continue
          if (orig.matchColigada !== null && orig.matchColigada !== coligada) continue
          if (orig.matchFilial !== null && orig.matchFilial !== filial) continue
          const specificity =
            (orig.matchColigada !== null ? 1 : 0) + (orig.matchFilial !== null ? 1 : 0)
          if (!best || specificity > best.specificity) {
            const value =
              rules.return === 'distanceKm'
                ? Number(route.distanceAsphaltKm) + Number(route.distanceDirtKm)
                : Number((route as unknown as Record<string, unknown>)[rules.return] ?? 0)
            best = { specificity, value }
          }
        }
        return { ...row, [col.name]: best?.value ?? 0 }
      })
    } else if (col.type === 'LOOKUP' && (col.rules as unknown as LookupRules).table === 'Location') {
      // Lookup no cadastro de Locais (unidades): casa por coligada/filial,
      // origem mais específica vence (matchFilial exato > matchColigada
      // coringa) — mesma regra de especificidade do lookup de Route. Evita
      // que "origem" fique dessincronizada do cadastro real de unidades
      // (bug encontrado em 2026-07-25: a regra fixa antiga não conhecia 4
      // unidades cadastradas depois dela e 3.680 de 5.966 linhas caíam em
      // "Outros").
      const rules = col.rules as unknown as LookupRules
      const fields = rules.localFields ?? { coligada: 'CODCOLIGADA', filial: 'CODFILIAL' }
      const units = await prisma.location.findMany({ where: { type: 'UNIDADE', active: true } })
      view = view.map((row) => {
        const coligada = Number(row[fields.coligada])
        const filial = Number(row[fields.filial])
        let best: { specificity: number; value: string } | null = null
        for (const u of units) {
          if (u.matchColigada !== null && u.matchColigada !== coligada) continue
          if (u.matchFilial !== null && u.matchFilial !== filial) continue
          const specificity = (u.matchColigada !== null ? 1 : 0) + (u.matchFilial !== null ? 1 : 0)
          if (!best || specificity > best.specificity) best = { specificity, value: u.name }
        }
        return { ...row, [col.name]: best?.value ?? 'Outros' }
      })
    } else if (col.type === 'LOOKUP' && (col.rules as unknown as LookupRules).table === 'ProductType') {
      // Lookup no cadastro de classificação de produto: casa por CODIGOPRD
      // (estável, ao contrário do nome livre PRODUTO). Sem cadastro -> "Outros".
      const rules = col.rules as unknown as LookupRules
      const fields = rules.localFields ?? { codigoPrd: 'CODIGOPRD' }
      const productTypes = await prisma.productType.findMany({ where: { active: true } })
      const index = new Map(productTypes.map((p) => [p.codigoPrd.trim().toUpperCase(), p.tipoProduto]))
      view = view.map((row) => {
        const codigo = String(row[fields.codigoPrd] ?? '').trim().toUpperCase()
        return { ...row, [col.name]: index.get(codigo) ?? 'Outros' }
      })
    } else if (col.type === 'LOOKUP') {
      const rules = col.rules as unknown as LookupRules
      const refDataset = rules.dataset
        ? await prisma.dataset.findUnique({ where: { code: rules.dataset } })
        : null
      if (!refDataset || !rules.matchOn) {
        view = view.map((row) => ({ ...row, [col.name]: null }))
        continue
      }
      const matchOn = rules.matchOn
      const refRows = await prisma.datasetRow.findMany({
        where: { datasetId: refDataset.id },
        select: { data: true },
      })
      const remoteFields = matchOn.map((m) => m.remote)
      const localFields = matchOn.map((m) => m.local)
      const index = new Map<string, unknown>()
      for (const r of refRows) {
        const data = r.data as Row
        index.set(lookupKey(data, remoteFields), data[rules.return])
      }
      view = view.map((row) => ({
        ...row,
        [col.name]: index.get(lookupKey(row, localFields)) ?? null,
      }))
    } else {
      const rules = col.rules as unknown as ConditionalRules
      view = view.map((row) => ({ ...row, [col.name]: evaluateConditional(row, rules) }))
    }
  }

  return view
}

/**
 * Data/hora da última atualização de dados de um painel, para exibir ao
 * usuário (pedido do usuário 2026-08-31: "colocar em cada painel qual foi a
 * data da última atualização de dados"). Usa o fim da última sincronização
 * BEM-SUCEDIDA de cada dataset (SyncRun.status = SUCCESS) — `SyncSchedule.
 * lastRunAt` marca toda tentativa, inclusive as que falharam, e não serve
 * pra isso. Quando o painel depende de mais de um dataset, retorna a mais
 * ANTIGA entre eles (pior caso: garante que todo dado visível no painel é
 * de até aquela data). `null` = algum dos datasets nunca sincronizou com
 * sucesso.
 */
export async function getUltimaAtualizacao(datasetCodes: string[]): Promise<Date | null> {
  const runs = await prisma.syncRun.findMany({
    where: { status: 'SUCCESS', dataset: { code: { in: datasetCodes } } },
    orderBy: { finishedAt: 'desc' },
    select: { finishedAt: true, dataset: { select: { code: true } } },
  })
  const maisRecentePorDataset = new Map<string, Date>()
  for (const run of runs) {
    if (!run.finishedAt) continue
    if (!maisRecentePorDataset.has(run.dataset.code)) maisRecentePorDataset.set(run.dataset.code, run.finishedAt)
  }
  if (maisRecentePorDataset.size < datasetCodes.length) return null
  return new Date(Math.min(...[...maisRecentePorDataset.values()].map((d) => d.getTime())))
}

export { applyComputedColumns }
