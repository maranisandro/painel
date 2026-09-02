import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { requireModuleEditor, badRequest } from '@/lib/api-helpers'
import { carregarNomesDistribuidoresVendas } from '@/lib/fase3/cotas'

const linhaSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  codDistribuidor: z.string().min(1),
  nomeDistribuidor: z.string().nullable().optional(),
  metaValor: z.number().nonnegative(),
})
const bodySchema = z.object({ linhas: z.array(linhaSchema).min(1).max(10000) })

function firstDay(month: string): Date {
  return new Date(`${month}-01T00:00:00`)
}

/** Importação em massa da planilha-matriz de cotas (distribuidor × mês) — ver comentário irmão em product-quotas/import-matriz/route.ts. */
export async function POST(req: NextRequest) {
  const auth = await requireModuleEditor('fase3')
  if ('error' in auth) return auth.error
  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) return badRequest(parsed.error.issues.map((i) => i.message).join('; '))

  // A planilha-matriz (aba "MetaDistribuidor") não tem coluna de nome — só o
  // código —, então `l.nomeDistribuidor` chega sempre null do parser
  // (`excel-matriz-cotas.ts`). Resolve pelo mesmo nome (ABREV_DISTRIBUIDOR)
  // já usado em todo o painel de vendas para esse código, em vez de deixar
  // em branco (pedido do usuário 2026-09-02: "o nome do distribuidor veio em
  // branco mas é o mesmo que esta nas vendas").
  const nomesVendas = await carregarNomesDistribuidoresVendas()

  let criados = 0
  let atualizados = 0
  const BATCH = 50
  const { linhas } = parsed.data
  for (let i = 0; i < linhas.length; i += BATCH) {
    const lote = linhas.slice(i, i + BATCH)
    const resultados = await Promise.all(
      lote.map(async (l) => {
        const monthDate = firstDay(l.month)
        const nomeResolvido = l.nomeDistribuidor ?? nomesVendas.get(l.codDistribuidor) ?? null
        const existing = await prisma.distributorQuota.findUnique({
          where: { month_codDistribuidor: { month: monthDate, codDistribuidor: l.codDistribuidor } },
        })
        await prisma.distributorQuota.upsert({
          where: { month_codDistribuidor: { month: monthDate, codDistribuidor: l.codDistribuidor } },
          create: {
            month: monthDate,
            codDistribuidor: l.codDistribuidor,
            nomeDistribuidor: nomeResolvido,
            metaValor: l.metaValor,
          },
          // `nomeDistribuidor` só entra no update quando há um valor
          // resolvido (planilha ou vendas) — `undefined` faz o Prisma OMITIR
          // o campo, preservando um nome já editado manualmente na tela
          // quando nem a planilha nem as vendas têm esse código.
          update: {
            ...(nomeResolvido ? { nomeDistribuidor: nomeResolvido } : {}),
            metaValor: l.metaValor,
          },
        })
        return existing ? 'atualizado' : 'criado'
      }),
    )
    criados += resultados.filter((r) => r === 'criado').length
    atualizados += resultados.filter((r) => r === 'atualizado').length
  }

  await logAudit({
    userId: auth.user.id,
    userName: auth.user.name,
    action: 'IMPORT_MATRIZ',
    entity: 'DistributorQuota',
    details: { total: linhas.length, criados, atualizados },
  })
  return NextResponse.json({ criados, atualizados })
}
