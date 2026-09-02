import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { requireModuleEditor, badRequest } from '@/lib/api-helpers'
import { carregarNomesProdutosVendas } from '@/lib/fase3/cotas'

const linhaSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  codigoPrd: z.string().min(1),
  nomeProduto: z.string().nullable().optional(),
  m3PorUnidade: z.number().nonnegative().nullable().optional(),
  cotaUnidades: z.number().nonnegative(),
})
const bodySchema = z.object({ linhas: z.array(linhaSchema).min(1).max(10000) })

function firstDay(month: string): Date {
  return new Date(`${month}-01T00:00:00`)
}

/**
 * Importação em massa da planilha-matriz de cotas (produto × mês) — pedido
 * do usuário 2026-09-01: a planilha original ("plancotas") tem uma coluna
 * por mês, não uma linha por mês como o cadastro manual/importação
 * unitária (`POST /api/admin/product-quotas`) espera. Faz UPSERT (não
 * rejeita duplicata como o POST unitário) — é assim que uma reimportação
 * depois de a planilha mudar deve se comportar: atualiza o que já existe,
 * cria o que falta.
 */
export async function POST(req: NextRequest) {
  const auth = await requireModuleEditor('fase3')
  if ('error' in auth) return auth.error
  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) return badRequest(parsed.error.issues.map((i) => i.message).join('; '))

  // Confere (sem sobrescrever) o nome importado da planilha contra o nome
  // usado nas vendas para o mesmo código — pedido do usuário 2026-09-02:
  // "confirme se os nomes estão igual das vendas". Decisão do usuário:
  // manter o nome da planilha como está (ela usa um "Nome Fantasia" mais
  // curto de propósito), só sinalizar quando o código também aparecer nas
  // vendas com um nome diferente, para revisão manual da planilha-base.
  const nomesVendas = await carregarNomesProdutosVendas()
  const divergenciasPorCodigo = new Map<string, string>()
  const { linhas } = parsed.data
  for (const l of linhas) {
    if (divergenciasPorCodigo.has(l.codigoPrd)) continue
    const nomeVenda = nomesVendas.get(l.codigoPrd)
    if (l.nomeProduto && nomeVenda && l.nomeProduto !== nomeVenda) {
      divergenciasPorCodigo.set(l.codigoPrd, `${l.codigoPrd} (planilha: "${l.nomeProduto}" / vendas: "${nomeVenda}")`)
    }
  }
  const avisos =
    divergenciasPorCodigo.size > 0
      ? [`${divergenciasPorCodigo.size} produto(s) com nome diferente do usado nas vendas (mantido o da planilha): ${[...divergenciasPorCodigo.values()].join('; ')}.`]
      : []

  let criados = 0
  let atualizados = 0
  const BATCH = 50
  for (let i = 0; i < linhas.length; i += BATCH) {
    const lote = linhas.slice(i, i + BATCH)
    const resultados = await Promise.all(
      lote.map(async (l) => {
        const monthDate = firstDay(l.month)
        const existing = await prisma.productQuota.findUnique({
          where: { month_codigoPrd: { month: monthDate, codigoPrd: l.codigoPrd } },
        })
        await prisma.productQuota.upsert({
          where: { month_codigoPrd: { month: monthDate, codigoPrd: l.codigoPrd } },
          create: {
            month: monthDate,
            codigoPrd: l.codigoPrd,
            nomeProduto: l.nomeProduto ?? null,
            m3PorUnidade: l.m3PorUnidade ?? null,
            cotaUnidades: l.cotaUnidades,
          },
          // `nomeProduto`/`m3PorUnidade` só entram no update quando a
          // planilha traz valor — `undefined` faz o Prisma OMITIR o campo,
          // preservando uma edição manual já feita na tela.
          update: {
            ...(l.nomeProduto ? { nomeProduto: l.nomeProduto } : {}),
            ...(l.m3PorUnidade != null ? { m3PorUnidade: l.m3PorUnidade } : {}),
            cotaUnidades: l.cotaUnidades,
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
    entity: 'ProductQuota',
    details: { total: linhas.length, criados, atualizados },
  })
  return NextResponse.json({ criados, atualizados, avisos })
}
