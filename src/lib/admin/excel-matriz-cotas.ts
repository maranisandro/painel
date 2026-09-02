import * as XLSX from 'xlsx'

export interface LinhaProdutoCota {
  month: string
  codigoPrd: string
  nomeProduto: string | null
  m3PorUnidade: number | null
  cotaUnidades: number
}

export interface LinhaDistribuidorCota {
  month: string
  codDistribuidor: string
  nomeDistribuidor: string | null
  metaValor: number
}

/**
 * Header de coluna de mês na planilha-matriz vem em dois formatos conforme
 * como a célula foi formatada no Excel: texto "dd/mm/aaaa"/"dd/mm/aa", ou
 * um serial de data do Excel (número puro, quando a célula tem formato de
 * data mas o cabeçalho foi lido como número) — pedido do usuário
 * 2026-09-01, arquivo real (`cotamadeiratratada.xlsx`) tem os dois casos
 * na mesma planilha (colunas mais antigas em texto, mais recentes como
 * serial).
 */
function parseHeaderMes(v: unknown): string | null {
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v)
    if (!d) return null
    return `${d.y}-${String(d.m).padStart(2, '0')}`
  }
  if (typeof v === 'string') {
    const m = v.trim().match(/^(\d{2})\/(\d{2})\/(\d{2,4})$/)
    if (!m) return null
    const [, , mm] = m
    let yyyy = m[3]
    if (yyyy.length === 2) yyyy = (Number(yyyy) < 50 ? '20' : '19') + yyyy
    return `${yyyy}-${mm}`
  }
  return null
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v.replace(',', '.')))) return Number(v.replace(',', '.'))
  return null
}

/**
 * Lê a planilha-matriz de cotas (pedido do usuário 2026-09-01) — formato
 * diferente do importador genérico (`importFromExcel`): aqui cada LINHA é
 * um produto/distribuidor e cada COLUNA (a partir de um ponto fixo) é um
 * mês, em vez de uma linha por (produto, mês). Lê 3 abas do arquivo
 * original:
 *   - "plancotas": Código do Produtos | Descrição | TIPO PRODUTO | <mês>...
 *     → fonte de `cotaUnidades` por produto×mês.
 *   - "Sheet": Código do Produtos | Nome Fantasia | ... | M3 | ...
 *     → enriquece nomeProduto/m3PorUnidade (não tem histórico por mês).
 *     Código que só existe aqui (não em "plancotas") é IGNORADO — pedido do
 *     usuário: sem granularidade mensal pra esse código, não dá pra saber
 *     em qual(is) mês(es) aplicar o valor único de "COTA MENSAL".
 *   - "MetaDistribuidor": CODDISTRIBUIDOR | <mês>... → fonte de metaValor
 *     por distribuidor×mês. A aba "MetaDistribuidor (2)" (versão antiga,
 *     com um distribuidor a mais só em 2019/2020) é ignorada por pedido do
 *     usuário.
 */
export function parseMatrizCotas(buffer: ArrayBuffer): {
  produtos: LinhaProdutoCota[]
  distribuidores: LinhaDistribuidorCota[]
  avisos: string[]
} {
  const wb = XLSX.read(buffer, { type: 'array' })
  const avisos: string[] = []

  // Modo array + busca de coluna por nome (.trim()) em vez do modo objeto do
  // SheetJS — achado real 2026-09-01: esta aba tem cabeçalhos com espaços
  // (" M3 ", " COTA MENSAL ") que o modo objeto usa literalmente como chave
  // (o valor formatado `.w` da célula, não o `.v` bruto), fazendo `r['M3']`
  // nunca bater e todo produto sair sem m3PorUnidade.
  const enriquecimentoProduto = new Map<string, { nomeProduto: string | null; m3PorUnidade: number | null }>()
  // Código duplicado na aba "Sheet" (nome/m³ por unidade) — pedido do usuário
  // 2026-09-02: mesma regra de "plancotas" (ver comentário lá): a última
  // linha processada venceria silenciosamente. Código duplicado aqui bloqueia
  // o produto INTEIRO (não só o enriquecimento) — sem saber qual nome/m³ é o
  // certo, importar a cota com um dos dois arriscaria ficar com o errado.
  const codigosDuplicadosSheet = new Set<string>()
  const sheetEnriquecimento = wb.Sheets['Sheet']
  if (sheetEnriquecimento) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheetEnriquecimento, { header: 1, defval: null })
    const header = (rows[0] ?? []).map((h) => String(h ?? '').trim())
    const idxCodigo = header.indexOf('Código do Produtos')
    const idxNome = header.indexOf('Nome Fantasia')
    const idxM3 = header.indexOf('M3')
    if (idxCodigo === -1) {
      avisos.push('Aba "Sheet" sem coluna "Código do Produtos" — produtos importados sem nome/m³ por unidade.')
    } else {
      const contagemLinhasPorCodigo = new Map<string, number>()
      const valoresPorCodigo = new Map<string, Set<string>>()
      for (const row of rows.slice(1)) {
        const codigo = String(row[idxCodigo] ?? '').trim()
        if (!codigo) continue
        contagemLinhasPorCodigo.set(codigo, (contagemLinhasPorCodigo.get(codigo) ?? 0) + 1)
        const nome = idxNome >= 0 ? String(row[idxNome] ?? '').trim() || '(sem nome)' : '(sem nome)'
        const m3 = idxM3 >= 0 ? num(row[idxM3]) : null
        const set = valoresPorCodigo.get(codigo) ?? new Set()
        set.add(`${nome} / M3=${m3 ?? '—'}`)
        valoresPorCodigo.set(codigo, set)
      }
      for (const [codigo, n] of contagemLinhasPorCodigo) if (n > 1) codigosDuplicadosSheet.add(codigo)

      for (const row of rows.slice(1)) {
        const codigo = String(row[idxCodigo] ?? '').trim()
        if (!codigo || codigosDuplicadosSheet.has(codigo)) continue
        enriquecimentoProduto.set(codigo, {
          nomeProduto: idxNome >= 0 ? String(row[idxNome] ?? '').trim() || null : null,
          m3PorUnidade: idxM3 >= 0 ? num(row[idxM3]) : null,
        })
      }
      if (codigosDuplicadosSheet.size > 0) {
        const detalhes = [...codigosDuplicadosSheet].map((c) => `${c} (${[...(valoresPorCodigo.get(c) ?? [])].join(' / ')})`)
        avisos.push(`${codigosDuplicadosSheet.size} código(s) de produto duplicados na aba "Sheet" (mais de uma linha para o mesmo código) — NENHUM importado, corrija a planilha primeiro: ${detalhes.join('; ')}.`)
      }
    }
  } else {
    avisos.push('Aba "Sheet" não encontrada — produtos importados sem nome/m³ por unidade.')
  }

  const produtos: LinhaProdutoCota[] = []
  const planCotas = wb.Sheets['plancotas']
  if (!planCotas) {
    avisos.push('Aba "plancotas" não encontrada — nenhuma cota de produto importada.')
  } else {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(planCotas, { header: 1, defval: null })
    const header = rows[0] ?? []
    const colunasMes = header.map((h, i) => ({ idx: i, mes: i >= 3 ? parseHeaderMes(h) : null })).filter((c) => c.mes)
    const linhasDeDados = rows.slice(1).filter((row) => String(row[0] ?? '').trim())

    // Achado real 2026-09-01 (arquivo do usuário): um código de produto
    // apareceu em DUAS linhas da planilha com descrições E cotas diferentes
    // (erro de digitação na planilha-base, não algo pra decidir sozinho
    // qual das duas prevalece — a última processada venceria silenciosamente
    // e a outra some). Código duplicado fica de fora do import inteiro, com
    // aviso, até o usuário corrigir a planilha.
    const descricoesPorCodigo = new Map<string, Set<string>>()
    const contagemLinhasPorCodigo = new Map<string, number>()
    for (const row of linhasDeDados) {
      const codigoPrd = String(row[0] ?? '').trim()
      const descricao = String(row[1] ?? '').trim() || '(sem descrição)'
      contagemLinhasPorCodigo.set(codigoPrd, (contagemLinhasPorCodigo.get(codigoPrd) ?? 0) + 1)
      const set = descricoesPorCodigo.get(codigoPrd) ?? new Set()
      set.add(descricao)
      descricoesPorCodigo.set(codigoPrd, set)
    }
    const codigosDuplicados = new Set([...contagemLinhasPorCodigo.entries()].filter(([, n]) => n > 1).map(([codigo]) => codigo))

    const codigosSoNaSheet = new Set(enriquecimentoProduto.keys())
    for (const row of linhasDeDados) {
      const codigoPrd = String(row[0] ?? '').trim()
      codigosSoNaSheet.delete(codigoPrd)
      if (codigosDuplicados.has(codigoPrd) || codigosDuplicadosSheet.has(codigoPrd)) continue
      const descricao = String(row[1] ?? '').trim() || null
      const enriq = enriquecimentoProduto.get(codigoPrd)
      for (const { idx, mes } of colunasMes) {
        const cotaUnidades = num(row[idx])
        if (cotaUnidades === null) continue
        produtos.push({
          month: mes!,
          codigoPrd,
          nomeProduto: enriq?.nomeProduto ?? descricao,
          m3PorUnidade: enriq?.m3PorUnidade ?? null,
          cotaUnidades,
        })
      }
    }
    if (codigosDuplicados.size > 0) {
      const detalhes = [...codigosDuplicados].map((c) => `${c} (${[...(descricoesPorCodigo.get(c) ?? [])].join(' / ')})`)
      avisos.push(`${codigosDuplicados.size} código(s) de produto duplicados na aba "plancotas" (mais de uma linha para o mesmo código) — NENHUM importado, corrija a planilha primeiro: ${detalhes.join('; ')}.`)
    }
    if (codigosSoNaSheet.size > 0) {
      avisos.push(`${codigosSoNaSheet.size} código(s) só existem na aba "Sheet" (sem histórico mensal) — ignorados: ${[...codigosSoNaSheet].join(', ')}.`)
    }
  }

  const distribuidores: LinhaDistribuidorCota[] = []
  const metaDist = wb.Sheets['MetaDistribuidor']
  if (!metaDist) {
    avisos.push('Aba "MetaDistribuidor" não encontrada — nenhuma meta de distribuidor importada.')
  } else {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(metaDist, { header: 1, defval: null })
    const header = rows[0] ?? []
    const colunasMes = header.map((h, i) => ({ idx: i, mes: i >= 1 ? parseHeaderMes(h) : null })).filter((c) => c.mes)
    const linhasDeDados = rows.slice(1).filter((row) => String(row[0] ?? '').trim())

    // Mesma checagem de duplicata que "plancotas" — ver comentário lá.
    const contagemLinhasPorCodigo = new Map<string, number>()
    for (const row of linhasDeDados) {
      const codDistribuidor = String(row[0] ?? '').trim()
      contagemLinhasPorCodigo.set(codDistribuidor, (contagemLinhasPorCodigo.get(codDistribuidor) ?? 0) + 1)
    }
    const codigosDuplicados = new Set([...contagemLinhasPorCodigo.entries()].filter(([, n]) => n > 1).map(([codigo]) => codigo))

    for (const row of linhasDeDados) {
      const codDistribuidor = String(row[0] ?? '').trim()
      if (codigosDuplicados.has(codDistribuidor)) continue
      for (const { idx, mes } of colunasMes) {
        const metaValor = num(row[idx])
        if (metaValor === null) continue
        distribuidores.push({ month: mes!, codDistribuidor, nomeDistribuidor: null, metaValor })
      }
    }
    if (codigosDuplicados.size > 0) {
      avisos.push(`${codigosDuplicados.size} código(s) de distribuidor duplicados na aba "MetaDistribuidor" (mais de uma linha para o mesmo código) — NENHUM importado, corrija a planilha primeiro: ${[...codigosDuplicados].join(', ')}.`)
    }
  }

  return { produtos, distribuidores, avisos }
}
