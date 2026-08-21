import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, hasModuleAccess } from '@/lib/authz'
import { prisma } from '@/lib/prisma'

/**
 * Frequência de erros de comunicação com a Omnilink — pedido do usuário
 * 2026-08-21: "precisamos de montar uma forma de detectar os erros de
 * comunicação com omnilink que estão frequentes". Motivo direto: o achado do
 * mesmo dia (RHX5D99/TBH2C10 presos em "sem comunicação" por causa de uma
 * falha intermitente de TLS) — investigando a fundo, o erro real
 * ("self-signed certificate in certificate chain") acontece no LOGIN/conexão
 * inicial com a Omnilink (antes do loop por placa começar: os SyncRun com
 * erro duram poucos segundos, tempo insuficiente pra sequer UMA placa
 * completar), então nenhum OmnilinkSyncPlaca chega a ser criado nessas
 * execuções — olhar só essa tabela deixaria a maioria dos erros invisível.
 * Por isso esta tela junta DUAS fontes:
 *  1. SyncRun do dataset inteiro (falha de login/conexão — a mais comum);
 *  2. OmnilinkSyncPlaca (falha numa placa específica já autenticada — mais
 *     rara, mas existe e não trava mais o lote inteiro desde a correção
 *     de 2026-08-21 em fetchOmnilinkPosicoes).
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser()
  if (!hasModuleAccess(user, 'fase1')) return NextResponse.json({ error: 'acesso negado' }, { status: 403 })

  const from = req.nextUrl.searchParams.get('from')
  const to = req.nextUrl.searchParams.get('to')
  const hoje = new Date()
  const fromDate = from ? new Date(`${from}T00:00:00`) : new Date(hoje.getTime() - 7 * 86_400_000)
  const toDate = to ? new Date(`${to}T23:59:59`) : hoje

  const dataset = await prisma.dataset.findFirst({ where: { code: 'fase1_omnilink_posicoes' } })

  const [execucoesBrutas, tentativasPlaca] = await Promise.all([
    dataset
      ? prisma.syncRun.findMany({
          where: { datasetId: dataset.id, startedAt: { gte: fromDate, lte: toDate } },
          select: { status: true, error: true, startedAt: true },
          orderBy: { startedAt: 'desc' },
        })
      : [],
    prisma.omnilinkSyncPlaca.findMany({
      where: { createdAt: { gte: fromDate, lte: toDate } },
      select: { placa: true, status: true, mensagem: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  // "Processo interrompido antes de terminar" NÃO é uma falha de comunicação
  // com a Omnilink — é o SyncRun órfão que `syncDatasetUnlocked` marca como
  // ERROR quando o PRÓPRIO PROCESSO (dev server, reinício de container etc.)
  // morre no meio de uma sincronização anterior, sem nunca ter chegado a
  // completar. Excluído por completo desta análise (nem conta como
  // execução, nem como erro) — achado real 2026-08-21: 90%+ de "erro" numa
  // semana de desenvolvimento com muitos reinícios do servidor local, quando
  // o problema real de comunicação era bem menor.
  const PADRAO_PROCESSO_INTERROMPIDO = /^Processo interrompido antes de terminar/
  const execucoes = execucoesBrutas.filter((e) => !PADRAO_PROCESSO_INTERROMPIDO.test(e.error ?? ''))
  const execucoesComErro = execucoes.filter((e) => e.status === 'ERROR')
  // NAO_LOCALIZADA não é uma falha de comunicação (é uma placa sem
  // rastreador/fora da conta Omnilink) — só OK e ERRO entram na taxa.
  const tentativasPlacaRelevantes = tentativasPlaca.filter((t) => t.status === 'OK' || t.status === 'ERRO')
  const errosPlaca = tentativasPlaca.filter((t) => t.status === 'ERRO')

  const totalExecucoes = execucoes.length
  const totalExecucoesComErro = execucoesComErro.length
  const taxaErroExecucaoPct = totalExecucoes > 0 ? (totalExecucoesComErro / totalExecucoes) * 100 : 0

  const totalTentativasPlaca = tentativasPlacaRelevantes.length
  const totalErrosPlaca = errosPlaca.length
  const taxaErroPlacaPct = totalTentativasPlaca > 0 ? (totalErrosPlaca / totalTentativasPlaca) * 100 : 0

  // Evento unificado (execução inteira OU placa específica) — usado nas duas
  // tabelas de baixo (por causa / últimas ocorrências), que não precisam
  // distinguir a granularidade de onde o erro veio.
  type EventoErro = { placa: string | null; mensagem: string | null; createdAt: string }
  const eventos: EventoErro[] = [
    ...execucoesComErro.map((e) => ({ placa: null, mensagem: e.error, createdAt: e.startedAt.toISOString() })),
    ...errosPlaca.map((e) => ({ placa: e.placa, mensagem: e.mensagem, createdAt: e.createdAt.toISOString() })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  // Agrupa por um texto "limpo" da mensagem — a causa real (ex.: TLS,
  // timeout, DNS) costuma vir depois de "causa:"; sem isso, cada mensagem
  // levemente diferente (placa/parte embutida) contaria como um erro único,
  // escondendo que é sempre o MESMO problema se repetindo.
  function normalizarErro(msg: string | null): string {
    if (!msg) return '(sem mensagem)'
    const m = msg.match(/causa:\s*(.+)$/i)
    const texto = (m ? m[1] : msg).trim()
    return texto.length > 120 ? `${texto.slice(0, 120)}…` : texto
  }

  const porTipo = new Map<string, { mensagem: string; count: number; placas: Set<string>; ultimaOcorrencia: string }>()
  for (const e of eventos) {
    const chave = normalizarErro(e.mensagem)
    const entry = porTipo.get(chave) ?? { mensagem: chave, count: 0, placas: new Set<string>(), ultimaOcorrencia: e.createdAt }
    entry.count++
    if (e.placa) entry.placas.add(e.placa)
    else entry.placas.add('(execução inteira)')
    if (e.createdAt > entry.ultimaOcorrencia) entry.ultimaOcorrencia = e.createdAt
    porTipo.set(chave, entry)
  }
  const porTipoErro = [...porTipo.values()]
    .map((e) => ({ mensagem: e.mensagem, count: e.count, placas: [...e.placas].sort(), ultimaOcorrencia: e.ultimaOcorrencia }))
    .sort((a, b) => b.count - a.count)

  // Série diária — combina execuções e tentativas por placa como a mesma
  // unidade "tentativa de falar com a Omnilink", pra enxergar se é um
  // problema pontual (um dia ruim) ou constante ao longo do período.
  const porDiaMap = new Map<string, { tentativas: number; erros: number }>()
  for (const e of execucoes) {
    const dia = e.startedAt.toISOString().slice(0, 10)
    const d = porDiaMap.get(dia) ?? { tentativas: 0, erros: 0 }
    d.tentativas++
    if (e.status === 'ERROR') d.erros++
    porDiaMap.set(dia, d)
  }
  for (const t of tentativasPlacaRelevantes) {
    const dia = t.createdAt.toISOString().slice(0, 10)
    const d = porDiaMap.get(dia) ?? { tentativas: 0, erros: 0 }
    d.tentativas++
    if (t.status === 'ERRO') d.erros++
    porDiaMap.set(dia, d)
  }
  const porDia = [...porDiaMap.entries()]
    .map(([dia, d]) => ({ dia, ...d, taxaErroPct: d.tentativas > 0 ? (d.erros / d.tentativas) * 100 : 0 }))
    .sort((a, b) => a.dia.localeCompare(b.dia))

  const ultimosErros = eventos.slice(0, 100).map((e) => ({
    placa: e.placa ?? '(execução inteira)',
    mensagem: e.mensagem,
    createdAt: e.createdAt,
  }))

  return NextResponse.json({
    totalExecucoes,
    totalExecucoesComErro,
    taxaErroExecucaoPct,
    totalTentativasPlaca,
    totalErrosPlaca,
    taxaErroPlacaPct,
    porTipoErro,
    porDia,
    ultimosErros,
  })
}
